import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
import {
	createPacer,
	parseDetail,
	parseListing,
	readDetail,
	readListing,
	wait,
	type Pace,
	type ReadDetail,
	type ReadListing,
	type Wait
} from './api.ts';
import { INSTANCES, type BakhagenInstance } from './instances.ts';
import { isFailure, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per hagelag per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale. Two
 * hagelag therefore produce two rows and two lines on the page, not one combined run.
 */

export type IngestResult = {
	runId: number;
	slug: string;
	status: 'success' | 'partial' | 'failed';
	fetched: number;
	created: number;
	updated: number;
	unchanged: number;
	rejected: number;
	durationMs: number;
	message: string | null;
};

export type IngestOptions = {
	readListing?: ReadListing;
	readDetail?: ReadDetail;
	/** Injected so tests wait for nothing — see `Wait` in api.ts. */
	wait?: Wait;
	pace?: Pace;
	trigger?: string;
	revision?: string | null;
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db, instance: BakhagenInstance) {
	const shared = {
		name: instance.name,
		url: instance.url,
		endpoint: instance.url,
		note: 'Aktivitetssida til hagelaget er vanleg HTML med schema.org-mikrodata i kvart kort. Vi les korta direkte og hentar omtalen frå sida til kvar aktivitet, med fem sekund mellom kvart kall slik robots.txt ber om.',
		kind: 'html' as const,
		/*
		 * Explicitly active.
		 *
		 * A source can arrive here already existing as a `link` row, which the directory registers
		 * with `active: false` because nothing was collecting it. Graduating it without flipping
		 * this back leaves a source that publishes events while being excluded from every count
		 * that means "places this list comes from" — visible on the page, invisible in the numbers.
		 */
		active: true,
		scheduleCron: instance.scheduleCron,
		iconUrl: instance.iconUrl,
		trusted: instance.trusted
	};
	const [row] = await db
		.insert(sources)
		.values({
			slug: instance.slug,
			region: instance.region,
			attribution: instance.attribution,
			...shared
		})
		.onConflictDoUpdate({ target: sources.slug, set: shared })
		.returning();
	if (!row) throw new Error(`could not register the source ${instance.slug}`);
	return row;
}

async function venueIdFor(db: Db, mapped: MappedEvent, instance: BakhagenInstance) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			municipality: null,
			timezone: instance.timezone,
			// Bakhagen renders an empty PostalAddress span and no coordinates anywhere. Flagged
			// rather than dropped, so an unplaceable venue is visible to the geocoder.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestInstance(
	connectionString: string,
	instance: BakhagenInstance,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const {
		readListing: listing = readListing,
		readDetail: detail = readDetail,
		wait: waitFor = wait,
		pace = createPacer(waitFor),
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db, instance);

	/*
	 * A dry run opens no run row: the row is inserted as `running` and only closed on the success
	 * path, so opening one would leave /datasamling showing an import that never finished.
	 */
	let runId = -1;
	if (!dryRun) {
		const [run] = await db
			.insert(ingestRuns)
			.values({ sourceId: source.id, startedAt, status: 'running', trigger, revision })
			.returning({ id: ingestRuns.id });
		if (!run) throw new Error('could not open an ingest run');
		runId = run.id;
	}

	let fetched = 0;
	let created = 0;
	let updated = 0;
	let unchanged = 0;
	let rejected = 0;
	const problems: string[] = [];

	try {
		await pace();
		const parsed = parseListing(await listing(instance), instance.url);

		/*
		 * Fail loudly when the page stops being the page.
		 *
		 * Zero activities is a legitimate answer here — a hagelag between programmes has nothing
		 * on, and the template then omits the activity list entirely rather than rendering an
		 * empty one. So "no events" cannot be an error, and without the check below a redesign, a
		 * moved URL or a login wall would all import nothing and report success. `recognised` is
		 * the page vouching for itself; see ParsedListing.
		 */
		if (!parsed.recognised) {
			throw new Error(
				`${instance.url} is no longer a Bakhagen activity page — the intro Article microdata naming this URL is gone`
			);
		}

		for (const problem of parsed.rejected) {
			rejected += 1;
			if (problems.length < 10) problems.push(problem);
		}

		const seen = new Set<string>();

		for (const raw of parsed.events) {
			fetched += 1;

			/*
			 * The description lives only on the activity's own page. A failure there is not a
			 * failure of the activity — we still have its title, time and place from the card — so
			 * it degrades to an event without a description rather than losing the row.
			 */
			let detailData = null;
			try {
				await pace();
				detailData = parseDetail(await detail(raw.sourceUrl));
			} catch (error) {
				if (problems.length < 10) {
					problems.push(
						`detail for ${raw.sourceUrl} failed: ${
							error instanceof Error ? error.message : String(error)
						}`
					);
				}
			}

			const mapped = mapEvent(raw, detailData, instance);
			if (isFailure(mapped)) {
				rejected += 1;
				if (problems.length < 10)
					problems.push(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}
			if (seen.has(mapped.externalId)) continue;
			seen.add(mapped.externalId);

			if (dryRun) {
				created += 1;
				continue;
			}

			const venueId = await venueIdFor(db, mapped, instance);

			const values = {
				sourceId: source.id,
				externalId: mapped.externalId,
				sourceUrl: mapped.sourceUrl,
				title: mapped.title,
				description: mapped.description,
				category: mapped.category,
				startsAt: mapped.startsAt,
				endsAt: mapped.endsAt,
				venueId,
				ctaUrl: mapped.ctaUrl,
				posterUrl: mapped.posterUrl,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? ('published' as const) : ('pending' as const)
			};

			// Read before write, so a run reports what actually changed rather than marking every
			// event "updated" daily and burying the one day a source really moved.
			const [existing] = await db
				.select({
					id: events.id,
					title: events.title,
					description: events.description,
					category: events.category,
					startsAt: events.startsAt,
					endsAt: events.endsAt,
					venueId: events.venueId,
					ctaUrl: events.ctaUrl,
					posterUrl: events.posterUrl,
					posterRightsVerified: events.posterRightsVerified,
					status: events.status
				})
				.from(events)
				.where(and(eq(events.sourceId, source.id), eq(events.externalId, mapped.externalId)))
				.limit(1);

			if (!existing) {
				await db.insert(events).values(values);
				created += 1;
				continue;
			}

			const same =
				existing.title === values.title &&
				existing.description === values.description &&
				existing.category === values.category &&
				+existing.startsAt === +values.startsAt &&
				(existing.endsAt?.getTime() ?? null) === (values.endsAt?.getTime() ?? null) &&
				existing.venueId === values.venueId &&
				existing.ctaUrl === values.ctaUrl &&
				existing.posterUrl === values.posterUrl &&
				existing.posterRightsVerified === values.posterRightsVerified &&
				existing.status === values.status;

			if (same) {
				unchanged += 1;
				continue;
			}

			await db
				.update(events)
				.set({ ...values, updatedAt: now() })
				.where(eq(events.id, existing.id));
			updated += 1;
		}

		const status: IngestResult['status'] = rejected > 0 ? 'partial' : 'success';
		const finishedAt = now();
		const durationMs = finishedAt.getTime() - startedAt.getTime();
		/*
		 * An empty programme is recorded in words, because the counts alone cannot tell it apart
		 * from a run that read a page and understood nothing. `recognised` has already proved the
		 * page is ours, so this is a fact about the hagelag rather than a warning about the code.
		 */
		const notes = [
			fetched === 0 ? 'the page lists no upcoming activities' : null,
			...problems
		].filter(Boolean);
		const message = notes.length ? notes.join('; ').slice(0, 2000) : null;

		if (!dryRun) {
			await db
				.update(ingestRuns)
				.set({
					finishedAt,
					status,
					fetched,
					created,
					updated,
					unchanged,
					rejected,
					durationMs,
					message
				})
				.where(eq(ingestRuns.id, runId));
			await db.update(sources).set({ lastRunAt: finishedAt }).where(eq(sources.id, source.id));
		}

		return {
			runId,
			slug: instance.slug,
			status,
			fetched,
			created,
			updated,
			unchanged,
			rejected,
			durationMs,
			message
		};
	} catch (error) {
		const finishedAt = now();
		const message = error instanceof Error ? error.message : String(error);
		// Nothing to close if the run was never opened.
		if (dryRun) throw error;
		await db
			.update(ingestRuns)
			.set({
				finishedAt,
				status: 'failed',
				fetched,
				created,
				updated,
				unchanged,
				rejected,
				durationMs: finishedAt.getTime() - startedAt.getTime(),
				message: message.slice(0, 2000)
			})
			.where(eq(ingestRuns.id, runId));
		throw error;
	}
}

/**
 * Every configured hagelag. One failing site must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 *
 * The pacer is created once and shared, so the crawl delay is honoured across the whole run and
 * not restarted for each hagelag.
 */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const pace = options.pace ?? createPacer(options.wait ?? wait);
	const results: IngestResult[] = [];
	for (const instance of INSTANCES) {
		try {
			results.push(await ingestInstance(connectionString, instance, { ...options, pace }));
		} catch (error) {
			results.push({
				runId: -1,
				slug: instance.slug,
				status: 'failed',
				fetched: 0,
				created: 0,
				updated: 0,
				unchanged: 0,
				rejected: 0,
				durationMs: 0,
				message: error instanceof Error ? error.message : String(error)
			});
		}
	}
	return results;
}
