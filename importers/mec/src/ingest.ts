import { eq, inArray } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import {
	ingestEach,
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { events, venues } from '@hendingar/core/schema';
import { fetchListing, parseListing, type FetchListing } from './api.ts';
import { INSTANCES, type MecInstance } from './instances.ts';
import { isFailure, isSupersededOccurrenceId, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per instance per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale. Two
 * instances therefore produce two rows and two lines on the page, not one combined run.
 */

export type IngestOptions = RunOptions & { read?: FetchListing };

function upsertSource(db: Db, instance: MecInstance) {
	return registerSource(db, {
		slug: instance.slug,
		name: instance.name,
		url: instance.url,
		endpoint: instance.endpoint,
		kind: 'html',
		note: 'Modern Events Calendar på WordPress. Klokka blir lesen av korta sida viser folk, ikkje av JSON-LD-en — den legg til tidssona to gonger.',
		scheduleCron: instance.scheduleCron,
		iconUrl: instance.iconUrl,
		trusted: instance.trusted,
		region: instance.region,
		attribution: instance.attribution
	});
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

/**
 * The identity `occurrenceId` used before it keyed on the day: `<post id>@<ISO instant>`.
 *
 * See `occurrenceId` for why it changed. This is here because a code deploy ships no data
 * (CLAUDE.md), so every row already written under the old key is still in the database — published,
 * two hours late, and unreachable by any run under the new key, because a corrected occurrence now
 * inserts alongside it instead of updating it. Nothing else prunes: this importer only ever reads
 * the first page of a listing, so "delete what the page no longer shows" would delete the future.
 *
 * Matching on the shape of the key is what makes this safe to run every day. It can only match ids
 * this importer wrote itself, and once the last of them is gone it matches nothing for the rest of
 * time — so it can be deleted at leisure rather than urgently. Deliberately not written as a
 * migration: this is data, and `packages/core/migrations` is schema.
 */
async function dropSupersededOccurrences(db: Db, sourceId: number): Promise<number> {
	const rows = await db
		.select({ id: events.id, externalId: events.externalId })
		.from(events)
		.where(eq(events.sourceId, sourceId));

	const stale = rows
		.filter((row) => row.externalId !== null && isSupersededOccurrenceId(row.externalId))
		.map((row) => row.id);
	if (stale.length === 0) return 0;

	// Hearts and views cascade from `events`, so the abandoned row takes its own counters with it.
	await db.delete(events).where(inArray(events.id, stale));
	return stale.length;
}

export async function ingestInstance(
	connectionString: string,
	instance: MecInstance,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { read = fetchListing } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, instance);

	const report = await recordRun(db, source.id, options, async (run) => {
		/*
		 * Before anything is written, and not on a dry run, which promises to write nothing.
		 * Reported in the run message rather than counted as an import: /datasamling's columns are
		 * about what a source published, and this is about what we had wrong.
		 */
		if (!run.dryRun) {
			const dropped = await dropSupersededOccurrences(db, source.id);
			if (dropped > 0) run.note(`dropped ${dropped} occurrence(s) under the superseded id`);
		}

		const listing = parseListing(await read(instance));
		for (const problem of listing.rejected) run.reject(`invalid ld+json: ${problem}`);

		/*
		 * MEC prints the same occurrence more than once on a page — the listing this was built
		 * against repeated five posts across twelve cards, and a card can appear in both a
		 * "featured" strip and the main list. De-duplicating keeps the run counts honest.
		 */
		const seen = new Set<string>();

		for (const occurrence of listing.occurrences) {
			run.counts.fetched += 1;
			const mapped = mapEvent(occurrence.event, occurrence.postId, occurrence.card, instance);
			if (isFailure(mapped)) {
				run.reject(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}
			if (seen.has(mapped.externalId)) continue;
			seen.add(mapped.externalId);

			if (run.dryRun) {
				run.counts.created += 1;
				continue;
			}

			await run.upsertEvent({
				sourceId: source.id,
				externalId: mapped.externalId,
				sourceUrl: mapped.sourceUrl,
				title: mapped.title,
				description: mapped.description,
				category: mapped.category,
				startsAt: mapped.startsAt,
				endsAt: mapped.endsAt,
				venueId: await venueIdFor(db, mapped, instance),
				ctaUrl: mapped.ctaUrl,
				posterUrl: mapped.posterUrl,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? 'published' : 'pending'
			});
		}
	});

	return { slug: instance.slug, ...report };
}

/**
 * Every configured instance. One failing site must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	return ingestEach(INSTANCES, (instance) => ingestInstance(connectionString, instance, options));
}
