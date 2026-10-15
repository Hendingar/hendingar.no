import { createDb, type Db } from '@hendingar/core/db';
import {
	ingestEach,
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { venues } from '@hendingar/core/schema';
import {
	INSTANCES,
	extractEvents,
	fetchPageData,
	type FetchPageData,
	type KulturhusInstance
} from './api.ts';
import { isFailure, mapEvents, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → validate → map → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per venue per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
 */

export type IngestOptions = RunOptions & { read?: FetchPageData };

function upsertSource(db: Db, instance: KulturhusInstance) {
	return registerSource(db, {
		slug: instance.slug,
		name: instance.name,
		url: instance.url,
		endpoint: instance.url,
		/*
		 * Replaces the note this row carried while it was a `link`, which said we did NOT collect
		 * it. Graduating a source without clearing that would leave /datasamling explaining why we
		 * cannot fetch a calendar it is, at that moment, showing fresh events from.
		 */
		note: 'Programsida er bygd med Gatsby, som legg ut same data som JSON. Vi les den fila — éin førespurnad — og lagar ei hending per framsyning.',
		kind: 'json-api',
		scheduleCron: instance.scheduleCron,
		iconUrl: instance.iconUrl,
		trusted: instance.trusted,
		region: instance.region,
		attribution: instance.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent, instance: KulturhusInstance) {
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
	instance: KulturhusInstance,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { read = fetchPageData } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, instance);

	const report = await recordRun(db, source.id, options, async (run) => {
		/*
		 * `extractEvents` throws rather than returning an empty list.
		 *
		 * A redesign that moves or renames the programme block must fail the run — "the source went
		 * quiet" reported as a successful import of zero events is the one outcome /datasamling
		 * cannot show honestly.
		 */
		const upstream = extractEvents(await read(instance));

		const seen = new Set<string>();

		for (const mapped of mapEvents(upstream, instance)) {
			run.counts.fetched += 1;
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
				posterSrcset: mapped.posterSrcset,
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
