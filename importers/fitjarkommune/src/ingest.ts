import { and, eq, sql } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import {
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { events, venues } from '@hendingar/core/schema';
import { markGoneUpstream } from '@hendingar/core/gone-upstream';
import {
	parseEntry,
	parseListing,
	readEntry,
	readListing,
	type ReadEntry,
	type ReadListing,
	type UpstreamEntry
} from './api.ts';
import { entryUrl, listingUrl, SITE } from './site.ts';
import { isFailure, mapEvent, sameDateLine, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → validate → map → upsert. No language model touches this path.
 *
 * Every execution writes an `ingest_runs` row, including failures. That row is what /datasamling
 * renders — without it the page could claim a source is collected but never show that it was.
 */

export type IngestOptions = RunOptions & {
	readListing?: ReadListing;
	readEntry?: ReadEntry;
};

function upsertSource(db: Db) {
	return registerSource(db, {
		slug: SITE.slug,
		name: SITE.name,
		url: listingUrl(),
		endpoint: listingUrl(),
		note:
			'Kommunen sin eigen kalender. Vi les lista over oppføringar og så kvar oppføring si eiga ' +
			'side, der dato, klokkeslett og stad står slik kommunen skreiv dei. Står det ikkje noko ' +
			'klokkeslett, viser vi heile dagen i staden for å gjette.',
		kind: 'html',
		scheduleCron: SITE.scheduleCron,
		iconUrl: SITE.iconUrl,
		trusted: SITE.trusted,
		region: SITE.region,
		attribution: SITE.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent): Promise<number | null> {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			/*
			 * Fitjar, and unlike the post towns other importers refuse to write here, this is a
			 * statement about the source rather than a reading of an address: it is the kommune's own
			 * calendar of what is on in the kommune. See `SITE.municipality`.
			 */
			municipality: SITE.municipality,
			// No address and no coordinates on the page. Flagged, so an unplaceable venue is visible.
			timezone: SITE.timezone,
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({
			target: venues.slug,
			set: {
				name: mapped.venueName,
				/*
				 * Filled in, never overwritten. The venue row is shared by every source that names the
				 * place, and one that already says where it is must not be corrected by this one.
				 */
				municipality: sql`coalesce(${venues.municipality}, ${SITE.municipality})`
			}
		})
		.returning({ id: venues.id });
	return row?.id ?? null;
}

/** Whether this source already holds a row under `externalId`. */
async function exists(db: Db, sourceId: number, externalId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: events.id })
		.from(events)
		.where(and(eq(events.sourceId, sourceId), eq(events.externalId, externalId)))
		.limit(1);
	return row !== undefined;
}

export async function ingest(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { readListing: listing = readListing, readEntry: entry = readEntry } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db);

	const report = await recordRun(db, source.id, options, async (run) => {
		const parsed = parseListing(await listing());
		for (const problem of parsed.rejected) run.reject(`invalid listing row: ${problem}`);

		const seen = new Set<string>();
		/*
		 * Every occurrence the calendar still lists, which is the set the sweep compares against.
		 *
		 * Filled from what was mapped, *and* from what was listed but refused: an entry whose date
		 * line we cannot read is still being published, and counting it absent would mark a live
		 * event gone on a technicality of ours. A refused entry has no day to key on, so its page id
		 * stands in for every day it might be on — see the prefix match below.
		 */
		const present = new Set<string>();
		const refusedPages = new Set<string>();

		for (const item of parsed.rows) {
			run.counts.fetched += 1;

			/*
			 * The date, the place and the poster live on the entry's own page. A failure there is
			 * not a failure of the entry — the list app has its title and its date line too — so it
			 * degrades to an event without a place rather than losing the row.
			 */
			let page: UpstreamEntry | null = null;
			try {
				page = parseEntry(await entry(entryUrl(item.URI)));
			} catch (error) {
				run.note(
					`entry ${entryUrl(item.URI)} unreadable, mapped from the listing alone: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}

			// The cross-check CLAUDE.md asks for: two renderings of one stored value must agree.
			if (page?.dateText && item.eventDate && !sameDateLine(page.dateText, item.eventDate)) {
				run.note(
					`${item.id}: card says "${item.eventDate}", entry says "${page.dateText}" — used the entry`
				);
			}

			const mapped = mapEvent(item, page);
			if (isFailure(mapped)) {
				refusedPages.add(item.id);
				run.reject(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}
			present.add(mapped.externalId);
			if (seen.has(mapped.externalId)) continue;
			seen.add(mapped.externalId);

			if (run.dryRun) {
				run.counts.created += 1;
				continue;
			}

			const venueId = await venueIdFor(db, mapped);

			/*
			 * A reading from the listing alone is a degraded one — no place, a smaller poster — and
			 * must not overwrite the full reading an earlier run stored. The row stays as it was until
			 * the entry page answers again; a row we do not have yet is still created from it.
			 */
			if (!page && (await exists(db, source.id, mapped.externalId))) {
				run.counts.unchanged += 1;
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
				venueId,
				posterUrl: mapped.posterUrl,
				posterSrcset: mapped.posterSrcset,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? 'published' : 'pending'
			});
		}

		/*
		 * What the calendar has stopped listing. Safe because the list app's state carries every
		 * entry it shows — `listingIsComplete` says so beside the URL that makes it true. Nothing is
		 * deleted. Rows of a page we refused this run are kept present whatever their day: we could
		 * not read its date, so we cannot say which of its rows it no longer means.
		 */
		let swept = { marked: 0, restored: 0 };
		if (SITE.listingIsComplete && !run.dryRun) {
			if (refusedPages.size > 0) {
				const ours = await db
					.select({ externalId: events.externalId })
					.from(events)
					.where(eq(events.sourceId, source.id));
				for (const row of ours) {
					const page = row.externalId?.split('@')[0];
					if (row.externalId && page && refusedPages.has(page)) present.add(row.externalId);
				}
			}
			swept = await markGoneUpstream(db, { sourceId: source.id, seen: present, now: run.now() });
		}

		/*
		 * Said out loud on the run, because a row leaving the site should never be something only
		 * the database knows about. Ahead of the problems, and outside their cap.
		 */
		const summary: string[] = [];
		if (swept.marked > 0) summary.push(`${swept.marked} no longer listed by the source`);
		if (swept.restored > 0) summary.push(`${swept.restored} listed again`);
		run.problems.unshift(...summary);
	});

	return { slug: SITE.slug, ...report };
}
