import { createDb, type Db } from '@hendingar/core/db';
import {
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { organizers, venues } from '@hendingar/core/schema';
import { SOURCE, collectPages, type FetchPage, fetchPage } from './api.ts';
import { isFailure, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → validate → map → upsert. No language model touches this path.
 *
 * Every execution writes an `ingest_runs` row, including failures. That row is what /datasamling
 * renders — without it the page could claim a source is collected but never show that it was.
 */

export type IngestOptions = RunOptions & { read?: FetchPage };

function upsertSource(db: Db) {
	/*
	 * `slug`, `region` and `attribution` are insert-only, as everywhere else: they are the identity
	 * and the credit, not settings to converge on. Everything else, `active` included, is written on
	 * every run — see `registerSource`.
	 */
	return registerSource(db, {
		slug: SOURCE.slug,
		name: SOURCE.name,
		url: SOURCE.url,
		endpoint: SOURCE.endpoint,
		note:
			'Innocode sin «bestevent»-plattform, kvitmerkt som Det skjer for Polaris-avisene. ' +
			'Sida renderer frå eit JSON-API, og det er det vi les — sideveksling går per veke, ikkje per rad.',
		kind: 'json-api',
		// A literal rather than config: this importer reads one source, so there is no instance to
		// carry it. It matches the cron in .github/workflows/ingest.yml.
		scheduleCron: '0 5 * * *',
		iconUrl: SOURCE.iconUrl,
		// Editorially moderated upstream — see the column comment in schema.ts.
		trusted: true,
		region: SOURCE.region,
		attribution: SOURCE.attribution
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
			timezone: SOURCE.timezone,
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
	const { read = fetchPage } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db);

	const report = await recordRun(db, source.id, options, async (run) => {
		const { pages, rejected: pageProblems } = await collectPages(read);
		for (const p of pageProblems) run.reject(`page ${p.page}: ${p.problem}`);

		// The same event appears in more than one weekly window when it spans weeks; last write
		// would win harmlessly, but de-duplicating keeps the counts honest.
		const seen = new Set<string>();

		for (const page of pages) {
			for (const raw of page.events) {
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

				// No description: this importer has never written one.
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
					ctaUrl: mapped.ctaUrl,
					posterUrl: mapped.posterUrl,
					posterSrcset: mapped.posterSrcset,
					posterRightsVerified: mapped.posterRightsVerified,
					status: source.trusted ? 'published' : 'pending'
				});
			}
		}
	});

	return { slug: SOURCE.slug, ...report };
}
