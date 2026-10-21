import { createDb, type Db } from '@hendingar/core/db';
import {
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { organizers, venues } from '@hendingar/core/schema';
import { markGoneUpstream } from '@hendingar/core/gone-upstream';
import { parseListing, read as fetchListing, type Read } from './api.ts';
import { SITE, listingUrl } from './site.ts';
import { isFailure, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → validate → map → upsert. No language model touches this path.
 *
 * Every execution writes an `ingest_runs` row, including failures. That row is what /datasamling
 * renders — without it the page could claim a source is collected but never show that it was.
 */

export type IngestOptions = RunOptions & { read?: Read };

function upsertSource(db: Db) {
	/*
	 * `active: true` and the note are written on every run by `registerSource`. Both used to be
	 * missing here, so this source could publish events while being excluded from every count
	 * that means "places this list comes from", and carried whatever note it was registered with
	 * as a `link` row.
	 *
	 * `slug`, `region` and `attribution` stay insert-only, as everywhere else: they are the identity
	 * and the credit, not settings to converge on.
	 */
	return registerSource(db, {
		slug: SITE.slug,
		name: SITE.name,
		url: listingUrl(),
		endpoint: listingUrl(),
		note:
			'Hendingssida til næringsrådet er bygd i Next.js og ber sine eigne data i sida. Vi les ' +
			'den datablokka — ikkje oppsettet — så ein ny design endrar ingenting så lenge dataa ' +
			'står. Eitt kall om dagen, til den same sida ein lesar opnar.',
		kind: 'html',
		// A literal rather than config: this importer reads one source, so there is no instance to
		// carry it. It matches the cron in infra/ingest.bicep.
		scheduleCron: SITE.scheduleCron,
		iconUrl: SITE.iconUrl,
		// Editorially moderated upstream — see the column comment in schema.ts.
		trusted: true,
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
			municipality: null,
			// The source gives a free-text venue name and no coordinates. Geocoding is a separate
			// concern; flagging it here is what stops an unplaceable venue from silently vanishing.
			timezone: SITE.timezone,
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

async function organizerIdFor(db: Db, mapped: MappedEvent): Promise<number | null> {
	if (!mapped.organizerName || !mapped.organizerSlug) return null;
	const [row] = await db
		.insert(organizers)
		.values({ name: mapped.organizerName, slug: mapped.organizerSlug })
		.onConflictDoUpdate({ target: organizers.slug, set: { name: mapped.organizerName } })
		.returning({ id: organizers.id });
	return row?.id ?? null;
}

export async function ingest(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { read = fetchListing } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db);

	const report = await recordRun(db, source.id, options, async (run) => {
		const parsed = parseListing(await read());
		for (const problem of parsed.rejected) run.reject(`invalid listing row: ${problem}`);

		// The listing carries the whole archive, so the same id cannot appear twice — but the set
		// is what keeps the counts honest if that ever stops being true.
		const seen = new Set<string>();
		/*
		 * Every event the site still lists.
		 *
		 * The same set as `seen` here, because this source publishes no status and we import every
		 * row it carries — but kept separate because they answer different questions, and the day
		 * this importer starts declining a row for a reason of its own, the sweep must not read
		 * that as the site having removed it.
		 */
		const present = new Set(parsed.rows.map((row) => row.id.trim()).filter(Boolean));

		for (const raw of parsed.rows) {
			run.counts.fetched += 1;
			const mapped = mapEvent(raw);
			if (isFailure(mapped)) {
				run.reject(`${mapped.externalId}: ${mapped.problem}`);
				continue;
			}
			if (seen.has(mapped.externalId)) continue;
			seen.add(mapped.externalId);

			if (run.dryRun) {
				run.counts.created += 1;
				continue;
			}

			const venueId = await venueIdFor(db, mapped);
			const organizerId = await organizerIdFor(db, mapped);

			await run.upsertEvent({
				sourceId: source.id,
				externalId: mapped.externalId,
				sourceUrl: mapped.sourceUrl,
				title: mapped.title,
				category: mapped.category,
				startsAt: mapped.startsAt,
				endsAt: mapped.endsAt,
				venueId,
				organizerId,
				description: mapped.description,
				status: source.trusted ? 'published' : 'pending'
			});
		}

		/*
		 * What the site has stopped listing. Safe because one response carries the whole archive —
		 * `listingIsComplete` says so beside the URL that makes it true. Nothing is deleted.
		 */
		let swept = { marked: 0, restored: 0 };
		if (SITE.listingIsComplete && !run.dryRun) {
			swept = await markGoneUpstream(db, { sourceId: source.id, seen: present, now: run.now() });
		}

		// Ahead of the problems and outside their cap, as they always were.
		const summary = [
			swept.marked > 0 ? `${swept.marked} no longer listed by the source` : null,
			swept.restored > 0 ? `${swept.restored} listed again` : null
		].filter((line) => line !== null);
		run.problems.unshift(...summary);
	});

	return { slug: SITE.slug, ...report };
}
