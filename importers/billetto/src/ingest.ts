import { createDb, type Db } from '@hendingar/core/db';
import {
	ingestEach,
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { venues } from '@hendingar/core/schema';
import { fetchAll, readSearch, type ReadSearch } from './api.ts';
import { ORGANISERS, organiserUrl, searchUrl, type BillettoOrganiser } from './organisers.ts';
import { isFailure, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per organiser per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
 */

export type IngestOptions = RunOptions & { search?: ReadSearch };

function upsertSource(db: Db, organiser: BillettoOrganiser) {
	return registerSource(db, {
		slug: organiser.slug,
		name: organiser.name,
		url: organiserUrl(organiser),
		endpoint: searchUrl().split('?')[0]!,
		kind: 'json-api',
		scheduleCron: organiser.scheduleCron,
		iconUrl: organiser.iconUrl,
		trusted: organiser.trusted,
		note:
			'Arrangøren sel billettar gjennom Billetto. Vi les søkjeindeksen profilsida deira sjølv ' +
			'brukar, filtrert på denne arrangøren.',
		region: organiser.region,
		// Attributed to the organiser, not the ticket platform: these are their events, and
		// Billetto is where they happen to be sold.
		attribution: organiser.name
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent, organiser: BillettoOrganiser) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			municipality: mapped.municipality,
			timezone: organiser.timezone,
			// Billetto does publish coordinates, but geocoding is a separate concern with its own
			// status column. Flagged rather than half-filled.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({
			target: venues.slug,
			set: {
				name: mapped.venueName,
				/*
				 * Only ever filled in, never blanked — the rule the three address-writing importers
				 * state explicitly and this one did not follow.
				 *
				 * `municipality` was written unconditionally, so a later hit where Billetto omits it
				 * overwrote a municipality we already held with `null`. That is worse than never
				 * having read one: the geocoder treats a null as "not yet done", so the value would
				 * come back and be erased again on the next run, and nothing anywhere would say why
				 * a venue kept losing its place.
				 */
				...(mapped.municipality ? { municipality: mapped.municipality } : {})
			}
		})
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestOrganiser(
	connectionString: string,
	organiser: BillettoOrganiser,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { search = readSearch } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, organiser);

	const report = await recordRun(db, source.id, options, async (run) => {
		const parsed = await fetchAll(organiser, search);
		for (const problem of parsed.rejected) run.reject(`invalid hit: ${problem}`);

		const seen = new Set<string>();

		for (const raw of parsed.events) {
			run.counts.fetched += 1;
			const mapped = mapEvent(raw, organiser);
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
				venueId: await venueIdFor(db, mapped, organiser),
				ctaUrl: mapped.ctaUrl,
				posterUrl: mapped.posterUrl,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? 'published' : 'pending'
			});
		}
	});

	return { slug: organiser.slug, ...report };
}

/**
 * Every configured organiser. One failing profile must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	return ingestEach(ORGANISERS, (organiser) =>
		ingestOrganiser(connectionString, organiser, options)
	);
}
