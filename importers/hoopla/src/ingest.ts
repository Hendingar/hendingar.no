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
	MAX_DETAILS,
	createPacer,
	parseDetail,
	parseEvents,
	readDetail,
	readEvents,
	wait,
	type Pace,
	type ReadDetail,
	type ReadEvents,
	type UpstreamEvent,
	type Wait
} from './api.ts';
import { SHOPS, eventsUrl, listingUrl, type HooplaShop } from './shops.ts';
import { describe, isFailure, isPublishable, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path (ADR 0004).
 *
 * One `ingest_runs` row per shop per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
 */

export type IngestOptions = RunOptions & {
	readEvents?: ReadEvents;
	readDetail?: ReadDetail;
	/** Injected so tests wait for nothing — see `Wait` in api.ts. */
	wait?: Wait;
	pace?: Pace;
};

function upsertSource(db: Db, shop: HooplaShop) {
	return registerSource(db, {
		slug: shop.slug,
		name: shop.name,
		url: listingUrl(shop),
		endpoint: eventsUrl(shop),
		kind: 'json-api',
		/*
		 * Written on every run rather than left to whatever was there before — the note describes
		 * how we collect a source, so the importer is what owns it. `aktivitetforalle` records
		 * what happens when it is not: a stale note told readers we collected nothing while 121
		 * events were being imported.
		 */
		note:
			'Billettbutikken til arrangøren på Hoopla. Vi les det same opne JSON-kallet som butikken ' +
			'sjølv brukar, og hentar omtalen frå kvar hending si eiga side. Utseld er ikkje det same ' +
			'som avlyst, så vi tek med hendingar det ikkje er billettar att til — avlyste tek vi ikkje.',
		scheduleCron: shop.scheduleCron,
		iconUrl: shop.iconUrl,
		trusted: shop.trusted,
		region: shop.region,
		attribution: shop.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	/*
	 * `pending` unless the source gave us a coordinate, which for this shop it never has.
	 *
	 * Not a geocoder — that was tried and rejected (see `packages/core/src/address.ts`: Kartverket
	 * matched five of sixteen Sunnhordland venues correctly and four *wrongly*). Hoopla's
	 * `location.coordinates` is read where present because that is the organiser's own assertion
	 * about their own venue, which is the only kind of coordinate worth storing.
	 */
	const located = mapped.latitude !== null && mapped.longitude !== null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			// A post town is not a municipality. See the note in map.ts.
			municipality: null,
			address: mapped.venueAddress.street,
			postalCode: mapped.venueAddress.postalCode,
			latitude: mapped.latitude,
			longitude: mapped.longitude,
			timezone: mapped.venueTimezone,
			geocodeStatus: located ? ('resolved' as const) : ('pending' as const)
		})
		.onConflictDoUpdate({
			target: venues.slug,
			set: {
				name: mapped.venueName,
				/*
				 * Only ever filled in, never blanked. A later run where the payload happens to omit
				 * the address must not erase one we already have: an event page that loses its
				 * address silently loses its rich result, and nothing would say why.
				 */
				...(mapped.venueAddress.street ? { address: mapped.venueAddress.street } : {}),
				...(mapped.venueAddress.postalCode ? { postalCode: mapped.venueAddress.postalCode } : {}),
				...(located
					? {
							latitude: mapped.latitude,
							longitude: mapped.longitude,
							geocodeStatus: 'resolved' as const
						}
					: {}),
				timezone: mapped.venueTimezone
			}
		})
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestShop(
	connectionString: string,
	shop: HooplaShop,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const {
		readEvents: fetchEvents = readEvents,
		readDetail: fetchDetail = readDetail,
		wait: waitFor = wait,
		pace = createPacer(waitFor)
	} = options;

	const db = createDb(connectionString);
	const source = await upsertSource(db, shop);

	const report = await recordRun(db, source.id, options, async (run) => {
		let skipped = 0;
		let describedFailures = 0;

		await pace();
		const parsed = parseEvents(await fetchEvents(shop));
		for (const problem of parsed.rejected) run.reject(`invalid event: ${problem}`);

		const publishable: UpstreamEvent[] = [];
		for (const event of parsed.rows) {
			if (!isPublishable(event)) {
				skipped += 1;
				continue;
			}
			publishable.push(event);
		}

		const seen = new Set<string>();

		for (const [index, event] of publishable.entries()) {
			run.counts.fetched += 1;
			const mapped = mapEvent(event, shop);
			if (isFailure(mapped)) {
				run.reject(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}
			/*
			 * A shop should not list one event twice, and this costs nothing to be sure of. Counted
			 * as neither unchanged nor created, because "unchanged" would imply we compared it
			 * against the database.
			 */
			if (seen.has(mapped.externalId)) continue;
			seen.add(mapped.externalId);

			/*
			 * The description, as a supplement: a detail request that fails costs this event its
			 * prose and nothing more. The alternative — letting it throw — would mean one 500 from
			 * a CDN dropping a whole shop's events on a day when the list call worked fine.
			 */
			if (index < MAX_DETAILS) {
				try {
					await pace();
					mapped.description = describe(parseDetail(await fetchDetail(shop, event.event_id)));
				} catch (error) {
					describedFailures += 1;
					const why = error instanceof Error ? error.message : String(error);
					run.note(`no description for ${mapped.externalId}: ${why}`);
				}
			}

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
				venueId: await venueIdFor(db, mapped),
				ctaUrl: mapped.ctaUrl,
				posterUrl: mapped.posterUrl,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? 'published' : 'pending'
			});
		}

		/*
		 * Ahead of the capped problems, and outside the cap, as they always were.
		 *
		 * A missing description is not a partial run — the event imported. It is still worth a
		 * line on /datasamling, because "every description stopped arriving" is what a moved
		 * detail endpoint looks like from here.
		 */
		const summary = [
			skipped > 0 ? `${skipped} cancelled events skipped` : null,
			describedFailures > 0 ? `${describedFailures} descriptions unavailable` : null,
			publishable.length > MAX_DETAILS
				? `${publishable.length - MAX_DETAILS} events imported without a description (over the ${MAX_DETAILS} detail budget)`
				: null
		].filter((line) => line !== null);
		run.problems.unshift(...summary);
	});

	return { slug: shop.slug, ...report };
}

/**
 * Every configured shop. One failing shop must not stop the others — they are independent sources
 * that happen to share a parser, so a failure is recorded against that source alone.
 *
 * The pacer is created once and shared, so the crawl delay holds across the whole run rather than
 * resetting per shop.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const pace = options.pace ?? createPacer(options.wait ?? wait);
	return ingestEach(SHOPS, (shop) => ingestShop(connectionString, shop, { ...options, pace }));
}
