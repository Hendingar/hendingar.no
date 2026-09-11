import { runAll, runIngest } from '@hendingar/importer/ingest';
import type { Importer, IngestResult, RunOptions } from '@hendingar/importer/contract';
import {
	ENDPOINT,
	INSTANCES,
	fetchEvents,
	responseSchema,
	type CheckinInstance,
	type FetchEvents
} from './api.ts';
import { mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → validate → map → upsert. No language model touches this path.
 *
 * The orchestration is `@hendingar/importer/ingest`, shared with every other importer. What is left
 * here is what only Checkin can answer.
 */

export type { IngestResult };

export type IngestOptions = RunOptions & { read?: FetchEvents };

function importer(read: FetchEvents): Importer<CheckinInstance, MappedEvent> {
	return {
		facts: (instance) => ({
			kind: 'json-api',
			endpoint: ENDPOINT,
			note: `GraphQL, customerId ${instance.customerId}. Sida til staden viser programmet i ein Checkin-widget, så vi hentar frå API-et under.`
		}),

		/*
		 * The whole envelope is validated before anything is mapped.
		 *
		 * A GraphQL API answers 200 with a changed shape just as happily as with the right one, and
		 * mapping first would turn that into a quiet run of zero events rather than a loud failure.
		 *
		 * `startedAt` is the run's own instant, not a live clock: the request filters on
		 * `EVENT_ENDS_AT >= <epoch seconds>`, so the time is part of the query and a test that
		 * injects `now` gets a fixed one.
		 */
		collect: async (instance, { startedAt }) => {
			const parsed = responseSchema.safeParse(await read(instance, startedAt));
			if (!parsed.success) {
				throw new Error(
					`unexpected response shape: ${parsed.error.issues
						.map((i) => `${i.path.join('.')}: ${i.message}`)
						.join('; ')
						.slice(0, 400)}`
				);
			}
			return parsed.data.data.allEventRegistrations.data.map((raw) => mapEvent(raw, instance));
		},

		values: ({ mapped, source, venueId }) => ({
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
			posterSrcset: mapped.posterSrcset,
			posterRightsVerified: mapped.posterRightsVerified,
			status: source.trusted ? 'published' : 'pending'
		})
	};
}

/** Every instance handed to us — `cli.ts` narrows the list when `--only` is given. */
export function ingest(
	connectionString: string,
	configs: readonly CheckinInstance[] = INSTANCES,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const { read = fetchEvents, ...run } = options;
	return runAll(connectionString, configs, importer(read), run);
}

/** One instance, for a targeted run or a test. */
export function ingestInstance(
	connectionString: string,
	instance: CheckinInstance,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { read = fetchEvents, ...run } = options;
	return runIngest(connectionString, instance, importer(read), run);
}
