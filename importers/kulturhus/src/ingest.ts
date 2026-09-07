import { runAll, runIngest } from '@hendingar/importer/ingest';
import type { Importer, IngestResult, RunOptions } from '@hendingar/importer/contract';
import {
	INSTANCES,
	extractEvents,
	fetchPageData,
	type FetchPageData,
	type KulturhusInstance
} from './api.ts';
import { mapEvents, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → validate → map → upsert. No language model touches this path.
 *
 * The orchestration — the `ingest_runs` row, the source upsert, the venue upsert, read-before-write,
 * the counters and the message — is `@hendingar/importer/ingest`, shared with every other importer.
 * What is left here is the four things only this source can answer.
 */

export type { IngestResult };

export type IngestOptions = RunOptions & { read?: FetchPageData };

function importer(read: FetchPageData): Importer<KulturhusInstance, MappedEvent> {
	return {
		facts: (instance) => ({
			kind: 'json-api',
			endpoint: instance.url,
			/*
			 * Replaces the note this row carried while it was a `link`, which said we did NOT collect
			 * it. Graduating a source without clearing that would leave /datasamling explaining why we
			 * cannot fetch a calendar it is, at that moment, showing fresh events from.
			 */
			note: 'Programsida er bygd med Gatsby, som legg ut same data som JSON. Vi les den fila — éin førespurnad — og lagar ei hending per framsyning.'
		}),

		/*
		 * `extractEvents` throws rather than returning an empty list.
		 *
		 * A redesign that moves or renames the programme block must fail the run — "the source went
		 * quiet" reported as a successful import of zero events is the one outcome /datasamling
		 * cannot show honestly.
		 */
		collect: async (instance) => mapEvents(extractEvents(await read(instance)), instance),

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

/**
 * Every venue handed to us — `cli.ts` narrows the list when `--only` is given.
 *
 * One entry point rather than the old `ingestInstance` + `ingestAll` pair: the selection belongs to
 * the command line, and `runAll` already records a failure against the source it happened to.
 */
export function ingest(
	connectionString: string,
	configs: readonly KulturhusInstance[] = INSTANCES,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const { read = fetchPageData, ...run } = options;
	return runAll(connectionString, configs, importer(read), run);
}

/** One venue, for a targeted run or a test. */
export function ingestInstance(
	connectionString: string,
	instance: KulturhusInstance,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { read = fetchPageData, ...run } = options;
	return runIngest(connectionString, instance, importer(read), run);
}
