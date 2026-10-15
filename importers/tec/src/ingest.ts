import { createDb, type Db } from '@hendingar/core/db';
import {
	ingestEach,
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { venues } from '@hendingar/core/schema';
import { fetchAll, readPage, type ReadPage } from './api.ts';
import { INSTANCES, type TecInstance } from './instances.ts';
import { isFailure, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per site per execution, including failures — /kjelder renders that table,
 * and a source that stops reporting must become visible rather than quietly stale. Two sites
 * therefore produce two rows and two lines on the page, not one combined run.
 *
 * **Zero events is a success, and that distinction is the whole health signal here.** Bømlo
 * Teater's calendar has nothing upcoming: the plugin is installed, the endpoint answers, and it
 * answers `total: 0`. A run that reads that must finish `success` with `fetched=0`, plainly
 * different from a run that could not reach the site at all, which finishes `failed`. Conflating
 * them would make the day the site actually breaks indistinguishable from every ordinary day.
 */

export type IngestOptions = RunOptions & { read?: ReadPage };

function upsertSource(db: Db, instance: TecInstance) {
	return registerSource(db, {
		slug: instance.slug,
		name: instance.name,
		url: instance.url,
		endpoint: instance.endpoint,
		kind: 'json-api',
		note: 'REST-API-et til The Events Calendar (`/wp-json/tribe/events/v1/events`), det same sida deira renderer frå.',
		scheduleCron: instance.scheduleCron,
		iconUrl: instance.iconUrl,
		trusted: instance.trusted,
		region: instance.region,
		attribution: instance.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent, instance: TecInstance) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			/*
			 * The venue block carries a `city`, and it is not a municipality: Bømlo Kulturhus reports
			 * "Bremnes", which is a village inside Bømlo and stopped being a municipality in 1963.
			 * Writing it into this column would be confidently wrong in exactly the way a null is
			 * not, and `pnpm consolidate` matches on the slug rather than on this.
			 */
			municipality: null,
			address: mapped.venueAddress.street,
			postalCode: mapped.venueAddress.postalCode,
			timezone: instance.timezone,
			// The venue block has an address but no coordinates. The address is written below;
			// coordinates stay unresolved.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({
			target: venues.slug,
			set: {
				name: mapped.venueName,
				/*
				 * Only ever filled in, never blanked. A later run where the source omits the address
				 * must not erase one we already have — the event page would silently lose its rich
				 * result and nothing would say why.
				 */
				...(mapped.venueAddress.street ? { address: mapped.venueAddress.street } : {}),
				...(mapped.venueAddress.postalCode ? { postalCode: mapped.venueAddress.postalCode } : {})
			}
		})
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestInstance(
	connectionString: string,
	instance: TecInstance,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { read = readPage } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, instance);

	const report = await recordRun(db, source.id, options, async (run) => {
		const collection = await fetchAll(instance, read);
		for (const problem of collection.rejected) run.reject(`invalid event record: ${problem}`);

		const seen = new Set<string>();

		for (const raw of collection.events) {
			run.counts.fetched += 1;
			const mapped = mapEvent(raw, instance);
			if (isFailure(mapped)) {
				run.reject(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}

			/*
			 * A repeated post id means the site is serving recurring occurrences under one id, which
			 * this key cannot represent — see the note on `externalId` in map.ts. Counted and
			 * reported rather than silently skipped, because the run is then genuinely incomplete
			 * and the fix is a code change, not a retry.
			 */
			if (seen.has(mapped.externalId)) {
				run.reject(
					`${mapped.title}: event id ${mapped.externalId} appears more than once — ` +
						'recurring occurrences need a compound external id'
				);
				continue;
			}
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
 * Every configured site. One failing site must not stop the others — they are independent sources
 * that happen to share a parser, so a failure is recorded against that source alone.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	return ingestEach(INSTANCES, (instance) => ingestInstance(connectionString, instance, options));
}
