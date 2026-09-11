import { runAll, runIngest } from '@hendingar/importer/ingest';
import type { Importer, IngestResult, RunOptions } from '@hendingar/importer/contract';
import {
	INSTANCES,
	extractEvents,
	extractNextData,
	fetchPage,
	type FetchPage,
	type FjordInstance
} from './api.ts';
import { mapEvents, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → validate → map → upsert. No language model touches this path.
 *
 * The orchestration is `@hendingar/importer/ingest`, shared with every other importer. What is left
 * here is what only this source can answer.
 */

export type { IngestResult };

export type IngestOptions = RunOptions & { read?: FetchPage };

function importer(read: FetchPage): Importer<FjordInstance, MappedEvent> {
	return {
		facts: (instance) => ({
			kind: 'html',
			endpoint: instance.url,
			note: 'Reiselivssida er bygd med Next.js, som legg dataa sine i sida som JSON. Vi les den blokka. Dette er ei samleside, så mykje av det står også hos staden sjølv — vi slår saman like hendingar.'
		}),

		/*
		 * `extractEvents` throws rather than returning an empty list.
		 *
		 * A redesign that moves or renames the data block must fail the run — "the source went quiet"
		 * reported as a successful import of zero events is the one outcome /datasamling cannot show
		 * honestly.
		 */
		collect: async (instance) =>
			mapEvents(extractEvents(extractNextData(await read(instance))), instance),

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
	configs: readonly FjordInstance[] = INSTANCES,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const { read = fetchPage, ...run } = options;
	return runAll(connectionString, configs, importer(read), run);
}

/** One instance, for a targeted run or a test. */
export function ingestInstance(
	connectionString: string,
	instance: FjordInstance,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { read = fetchPage, ...run } = options;
	return runIngest(connectionString, instance, importer(read), run);
}
