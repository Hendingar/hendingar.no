import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
import { parseEvents, parseFilters, parseLocations, read, type Read } from './api.ts';
import { SITES, listingUrl, eventsUrl, type AfaSite } from './sites.ts';
import { isFailure, isPublishableEvent, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per site per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
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
	fetcher?: Read;
	trigger?: string;
	revision?: string | null;
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db, site: AfaSite) {
	const shared = {
		name: site.name,
		url: listingUrl(site),
		endpoint: eventsUrl(site),
		kind: 'json-api' as const,
		/*
		 * Written on every run, not left to whatever was there before.
		 *
		 * This source was registered as a `link` first, with a note saying we could not collect
		 * from it until events could be told from standing activities. That note survived the
		 * graduation — `upsertSource` did not touch the column — so /datasamling went on telling
		 * readers we collected nothing here while 121 events were being imported. A source's note
		 * describes how we collect it, so the importer is what owns it.
		 */
		note:
			'Portalen listar både enkelthendingar og faste, vekevise tilbod. Vi hentar berre ' +
			'arrangement som er publiserte og har eit tidspunkt — dei faste tilboda blir ståande ' +
			'hos kjelda.',
		active: true,
		scheduleCron: site.scheduleCron,
		iconUrl: site.iconUrl,
		trusted: site.trusted
	};
	const [row] = await db
		.insert(sources)
		.values({ slug: site.slug, region: site.region, attribution: site.attribution, ...shared })
		.onConflictDoUpdate({ target: sources.slug, set: shared })
		.returning();
	if (!row) throw new Error(`could not register the source ${site.slug}`);
	return row;
}

async function venueIdFor(db: Db, mapped: MappedEvent, site: AfaSite) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			municipality: null,
			timezone: site.timezone,
			// The portal carries a gps field and fills it on no event at all. Flagged rather than
			// dropped, so an unplaceable venue is visible to the geocoder instead of vanishing.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestSite(
	connectionString: string,
	site: AfaSite,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const {
		fetcher = read,
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db, site);

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
	let skipped = 0;
	const problems: string[] = [];

	try {
		const payload = await fetcher(site);
		const vocabulary = parseFilters(payload.filters);
		const locations = parseLocations(payload.locations);
		const parsed = parseEvents(payload.events);

		for (const problem of parsed.rejected) {
			rejected += 1;
			if (problems.length < 10) problems.push(`invalid event row: ${problem}`);
		}

		const seen = new Set<string>();

		for (const raw of parsed.rows) {
			/*
			 * Archived and draft rows, the standing weekly activities, and the one public event
			 * that never got a start time.
			 *
			 * Counted separately from `rejected`: nothing changed shape, these are simply rows the
			 * portal holds that a what's-on listing should not repeat. `rejected` must go on
			 * meaning "the source moved".
			 */
			if (!isPublishableEvent(raw, site.timezone)) {
				skipped += 1;
				continue;
			}

			fetched += 1;
			const mapped = mapEvent(raw, site, vocabulary, locations);
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

			const venueId = await venueIdFor(db, mapped, site);

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
					status: events.status,
					sourceUrl: events.sourceUrl
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
				existing.status === values.status &&
				existing.sourceUrl === values.sourceUrl;

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
		 * The skipped count is recorded even on a clean run: it is the only place the decision to
		 * take `arrangement` and leave `activity` is visible, and the number that moves if the
		 * portal changes how it files things.
		 */
		const notes = [
			skipped > 0
				? `${skipped} rows skipped (archived, draft, standing activity or undated)`
				: null,
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
			slug: site.slug,
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
 * Every configured site. One failing portal must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const results: IngestResult[] = [];
	for (const site of SITES) {
		try {
			results.push(await ingestSite(connectionString, site, options));
		} catch (error) {
			results.push({
				runId: -1,
				slug: site.slug,
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
