import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
import { fetchAll, readPage, type ReadPage } from './api.ts';
import { INSTANCES, type TecInstance } from './instances.ts';
import { isFailure, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per site per execution, including failures — /kjelder renders that table,
 * and a source that stops reporting must become visible rather than quietly stale. Two sites
 * therefore produce two rows and two lines on the page, not one combined run.
 *
 * **Zero events is a success, and that distinction is the whole health signal here.** Bømlo
 * Teater's calendar has nothing upcoming: the plugin is installed, the endpoint answers, and it
 * answers `total: 0`. A run that reads that must finish `success` with `fetched=0`, plainly
 * different from a run that could not reach the site at all, which finishes `failed`. Conflating
 * them would make the day the site actually breaks indistinguishable from every ordinary day.
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
	read?: ReadPage;
	trigger?: string;
	revision?: string | null;
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db, instance: TecInstance) {
	const shared = {
		name: instance.name,
		url: instance.url,
		endpoint: instance.endpoint,
		kind: 'json-api' as const,
		note: 'REST-API-et til The Events Calendar (`/wp-json/tribe/events/v1/events`), det same sida deira renderer frå.',
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

async function venueIdFor(db: Db, mapped: MappedEvent, instance: TecInstance) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			/*
			 * The venue block carries a `city`, and it is not a municipality: Bømlo Kulturhus reports
			 * "Bremnes", which is a village inside Bømlo and stopped being a municipality in 1963.
			 * Writing it into this column would be confidently wrong in exactly the way a null is
			 * not, and `pnpm consolidate` matches on the slug rather than on this.
			 */
			municipality: null,
			address: mapped.venueAddress.street,
			postalCode: mapped.venueAddress.postalCode,
			timezone: instance.timezone,
			// The venue block has an address but no coordinates. The address is written below;
			// coordinates stay unresolved.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({
			target: venues.slug,
			set: {
				name: mapped.venueName,
				/*
				 * Only ever filled in, never blanked. A later run where the source omits the address
				 * must not erase one we already have — the event page would silently lose its rich
				 * result and nothing would say why.
				 */
				...(mapped.venueAddress.street ? { address: mapped.venueAddress.street } : {}),
				...(mapped.venueAddress.postalCode ? { postalCode: mapped.venueAddress.postalCode } : {})
			}
		})
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestInstance(
	connectionString: string,
	instance: TecInstance,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const {
		read = readPage,
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db, instance);

	/*
	 * A dry run opens no run row.
	 *
	 * The row is inserted as `running` and only closed on the success path, so a dry run would
	 * otherwise leave one permanently `running` — /kjelder then shows an import that never finished
	 * and never happened. A flag that promises to write nothing must not write the one row the
	 * status board is built from.
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
		const collection = await fetchAll(instance, read);
		for (const problem of collection.rejected) {
			rejected += 1;
			if (problems.length < 10) problems.push(`invalid event record: ${problem}`);
		}

		const seen = new Set<string>();

		for (const raw of collection.events) {
			fetched += 1;
			const mapped = mapEvent(raw, instance);
			if (isFailure(mapped)) {
				rejected += 1;
				if (problems.length < 10)
					problems.push(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}

			/*
			 * A repeated post id means the site is serving recurring occurrences under one id, which
			 * this key cannot represent — see the note on `externalId` in map.ts. Counted and
			 * reported rather than silently skipped, because the run is then genuinely incomplete
			 * and the fix is a code change, not a retry.
			 */
			if (seen.has(mapped.externalId)) {
				rejected += 1;
				if (problems.length < 10)
					problems.push(
						`${mapped.title}: event id ${mapped.externalId} appears more than once — ` +
							'recurring occurrences need a compound external id'
					);
				continue;
			}
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
				posterSrcset: mapped.posterSrcset,
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
					posterSrcset: events.posterSrcset,
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
				existing.posterSrcset === values.posterSrcset &&
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
		const message = problems.length ? problems.join('; ').slice(0, 2000) : null;

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
 * Every configured site. One failing site must not stop the others — they are independent sources
 * that happen to share a parser, so a failure is recorded against that source alone.
 */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const results: IngestResult[] = [];
	for (const instance of INSTANCES) {
		try {
			results.push(await ingestInstance(connectionString, instance, options));
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
