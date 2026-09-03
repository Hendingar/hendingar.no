import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
import { fetchListing, parseListing, postIdFor, type FetchListing } from './api.ts';
import { INSTANCES, type MecInstance } from './instances.ts';
import { isFailure, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per instance per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale. Two
 * instances therefore produce two rows and two lines on the page, not one combined run.
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
	read?: FetchListing;
	trigger?: string;
	revision?: string | null;
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db, instance: MecInstance) {
	const shared = {
		name: instance.name,
		url: instance.url,
		endpoint: instance.endpoint,
		kind: 'html' as const,
		scheduleCron: instance.scheduleCron,
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

async function venueIdFor(db: Db, mapped: MappedEvent, instance: MecInstance) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			municipality: null,
			timezone: instance.timezone,
			// No coordinates anywhere in MEC's output. Flagged rather than dropped, so an
			// unplaceable venue is visible to the geocoder instead of vanishing.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestInstance(
	connectionString: string,
	instance: MecInstance,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const {
		read = fetchListing,
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db, instance);

	const [run] = await db
		.insert(ingestRuns)
		.values({ sourceId: source.id, startedAt, status: 'running', trigger, revision })
		.returning({ id: ingestRuns.id });
	if (!run) throw new Error('could not open an ingest run');

	let fetched = 0;
	let created = 0;
	let updated = 0;
	let unchanged = 0;
	let rejected = 0;
	const problems: string[] = [];

	try {
		const listing = parseListing(await read(instance));
		for (const problem of listing.rejected) {
			rejected += 1;
			if (problems.length < 10) problems.push(`invalid ld+json: ${problem}`);
		}

		/*
		 * MEC prints the same occurrence more than once on a page — the listing this was built
		 * against repeated five posts across twelve cards, and a card can appear in both a
		 * "featured" strip and the main list. De-duplicating keeps the run counts honest.
		 */
		const seen = new Set<string>();

		for (const raw of listing.events) {
			fetched += 1;
			const mapped = mapEvent(raw, postIdFor(listing, raw.url), instance);
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
				.where(eq(ingestRuns.id, run.id));
			await db.update(sources).set({ lastRunAt: finishedAt }).where(eq(sources.id, source.id));
		}

		return {
			runId: run.id,
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
			.where(eq(ingestRuns.id, run.id));
		throw error;
	}
}

/**
 * Every configured instance. One failing site must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
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
