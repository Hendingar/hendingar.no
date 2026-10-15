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
	ENDPOINT,
	INSTANCES,
	fetchEvents,
	responseSchema,
	type CheckinInstance,
	type FetchEvents
} from './api.ts';
import { isFailure, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → validate → map → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per venue per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
 */

export type IngestOptions = RunOptions & { read?: FetchEvents };

function upsertSource(db: Db, instance: CheckinInstance) {
	return registerSource(db, {
		slug: instance.slug,
		name: instance.name,
		url: instance.url,
		endpoint: ENDPOINT,
		/*
		 * Replaces the note this row carried while it was a `link`, which said we did NOT collect
		 * it. Graduating a source without clearing that would leave /datasamling explaining why we
		 * cannot fetch a calendar it is, at that moment, showing fresh events from.
		 */
		note: `GraphQL, customerId ${instance.customerId}. Sida til staden viser programmet i ein Checkin-widget, så vi hentar frå API-et under.`,
		kind: 'json-api',
		scheduleCron: instance.scheduleCron,
		iconUrl: instance.iconUrl,
		trusted: instance.trusted,
		region: instance.region,
		attribution: instance.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent, instance: CheckinInstance) {
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
	instance: CheckinInstance,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { read = fetchEvents } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, instance);

	const report = await recordRun(db, source.id, options, async (run) => {
		/*
		 * Validate the whole envelope before mapping anything. A GraphQL API answers 200 with a
		 * changed shape just as happily as with the right one, and mapping first would turn that
		 * into a quiet run of zero events rather than a loud failure.
		 */
		const parsed = responseSchema.safeParse(await read(instance, run.now()));
		if (!parsed.success) {
			throw new Error(
				`unexpected response shape: ${parsed.error.issues
					.map((i) => `${i.path.join('.')}: ${i.message}`)
					.join('; ')
					.slice(0, 400)}`
			);
		}

		const seen = new Set<string>();

		for (const raw of parsed.data.data.allEventRegistrations.data) {
			run.counts.fetched += 1;
			const mapped = mapEvent(raw, instance);
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
