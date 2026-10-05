import { and, eq, sql } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
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

export type IngestResult = {
	runId: number;
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
	readEntry?: ReadEntry;
	trigger?: string;
	revision?: string | null;
	/** Map and count, write nothing. For inspecting a source change safely. */
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db) {
	/*
	 * One object, spread into both halves, so the insert and the update cannot drift. `slug`,
	 * `region` and `attribution` stay insert-only, as everywhere else: they are the identity and the
	 * credit, not settings to converge on.
	 */
	const shared = {
		name: SITE.name,
		url: listingUrl(),
		endpoint: listingUrl(),
		note:
			'Kommunen sin eigen kalender. Vi les lista over oppføringar og så kvar oppføring si eiga ' +
			'side, der dato, klokkeslett og stad står slik kommunen skreiv dei. Står det ikkje noko ' +
			'klokkeslett, viser vi heile dagen i staden for å gjette.',
		kind: 'html' as const,
		active: true,
		scheduleCron: SITE.scheduleCron,
		iconUrl: SITE.iconUrl,
		trusted: SITE.trusted
	};
	const [row] = await db
		.insert(sources)
		.values({ slug: SITE.slug, region: SITE.region, attribution: SITE.attribution, ...shared })
		.onConflictDoUpdate({ target: sources.slug, set: shared })
		.returning();
	if (!row) throw new Error('could not register the source');
	return row;
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

export async function ingest(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const {
		readListing: listing = readListing,
		readEntry: entry = readEntry,
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db);

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
	const note = (problem: string) => {
		if (problems.length < 10) problems.push(problem);
	};

	try {
		const parsed = parseListing(await listing());
		for (const problem of parsed.rejected) {
			rejected += 1;
			note(`invalid listing row: ${problem}`);
		}

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
			fetched += 1;

			/*
			 * The date, the place and the poster live on the entry's own page. A failure there is
			 * not a failure of the entry — the list app has its title and its date line too — so it
			 * degrades to an event without a place rather than losing the row.
			 */
			let page: UpstreamEntry | null = null;
			try {
				page = parseEntry(await entry(entryUrl(item.URI)));
			} catch (error) {
				note(
					`entry ${entryUrl(item.URI)} unreadable, mapped from the listing alone: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}

			// The cross-check CLAUDE.md asks for: two renderings of one stored value must agree.
			if (page?.dateText && item.eventDate && !sameDateLine(page.dateText, item.eventDate)) {
				note(
					`${item.id}: card says "${item.eventDate}", entry says "${page.dateText}" — used the entry`
				);
			}

			const mapped = mapEvent(item, page);
			if (isFailure(mapped)) {
				rejected += 1;
				refusedPages.add(item.id);
				note(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}
			present.add(mapped.externalId);
			if (seen.has(mapped.externalId)) continue;
			seen.add(mapped.externalId);

			if (dryRun) {
				created += 1;
				continue;
			}

			const venueId = await venueIdFor(db, mapped);

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
				posterUrl: mapped.posterUrl,
				posterSrcset: mapped.posterSrcset,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? ('published' as const) : ('pending' as const)
			};

			// Read before write, so a run reports what actually changed rather than marking every
			// event "updated" daily and burying the one day the source really moved.
			const [existing] = await db
				.select({
					id: events.id,
					title: events.title,
					description: events.description,
					category: events.category,
					startsAt: events.startsAt,
					endsAt: events.endsAt,
					venueId: events.venueId,
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

			/*
			 * A reading from the listing alone is a degraded one — no place, a smaller poster — and
			 * must not overwrite the full reading an earlier run stored. The row stays as it was until
			 * the entry page answers again.
			 */
			if (!page) {
				unchanged += 1;
				continue;
			}

			const same =
				existing.title === values.title &&
				existing.description === values.description &&
				existing.category === values.category &&
				+existing.startsAt === +values.startsAt &&
				(existing.endsAt?.getTime() ?? null) === (values.endsAt?.getTime() ?? null) &&
				existing.venueId === values.venueId &&
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

		/*
		 * What the calendar has stopped listing. Safe because the list app's state carries every
		 * entry it shows — `listingIsComplete` says so beside the URL that makes it true. Nothing is
		 * deleted. Rows of a page we refused this run are kept present whatever their day: we could
		 * not read its date, so we cannot say which of its rows it no longer means.
		 */
		let swept = { marked: 0, restored: 0 };
		if (SITE.listingIsComplete && !dryRun) {
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
			swept = await markGoneUpstream(db, { sourceId: source.id, seen: present, now: now() });
		}

		const status: IngestResult['status'] = rejected > 0 ? 'partial' : 'success';
		const finishedAt = now();
		const durationMs = finishedAt.getTime() - startedAt.getTime();
		const notes = [
			// Said out loud on the run, because a row leaving the site should never be something
			// only the database knows about.
			swept.marked > 0 ? `${swept.marked} no longer listed by the source` : null,
			swept.restored > 0 ? `${swept.restored} listed again` : null,
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
