import { createDb, type Db } from '@hendingar/core/db';
import {
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { venues } from '@hendingar/core/schema';
import { parseYear, read as fetchYear, type Read } from './api.ts';
import { SITE, listingUrl } from './site.ts';
import type { UpstreamCard } from './api.ts';
import { isFailure, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → validate → map → upsert. No language model touches this path.
 *
 * Every execution writes an `ingest_runs` row, including failures. That row is what /datasamling
 * renders — without it the page could claim a source is collected but never show that it was.
 */

export type IngestOptions = RunOptions & { read?: Read };

function upsertSource(db: Db) {
	return registerSource(db, {
		slug: SITE.slug,
		name: SITE.name,
		url: listingUrl(),
		endpoint: listingUrl(),
		note:
			'Aktivitetskalenderen har ikkje årstal nokon stad på sida sjølv. Vi spør difor same ' +
			'endepunktet som årsfilteret på sida, eitt kall per år, og får år og månad oppgjeve i ' +
			'svaret — så datoen er noko kjelda seier, ikkje noko vi reknar oss fram til.',
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

export async function ingest(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { read = fetchYear } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db);

	const report = await recordRun(db, source.id, options, async (run) => {
		/*
		 * This year and the next.
		 *
		 * A run in December must see January, and the endpoint answers one year at a time. Two
		 * calls is the whole cost of never guessing a year.
		 */
		const thisYear = run.now().getFullYear();
		const rows: UpstreamCard[] = [];
		for (const year of [thisYear, thisYear + 1]) {
			const parsed = parseYear(await read(year));
			for (const problem of parsed.rejected) run.reject(`${year}: ${problem}`);
			rows.push(...parsed.rows);
		}

		// An activity listed under two years would be the CMS contradicting itself, but the set is
		// what keeps the counts honest rather than double-reporting it.
		const seen = new Set<string>();

		for (const raw of rows) {
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

			// No description and no call to action: the source publishes neither, and only what is
			// sent is compared or written.
			await run.upsertEvent({
				sourceId: source.id,
				externalId: mapped.externalId,
				sourceUrl: mapped.sourceUrl,
				title: mapped.title,
				category: mapped.category,
				startsAt: mapped.startsAt,
				endsAt: mapped.endsAt,
				venueId: await venueIdFor(db, mapped),
				posterUrl: mapped.posterUrl,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? 'published' : 'pending'
			});
		}
	});

	return { slug: SITE.slug, ...report };
}
