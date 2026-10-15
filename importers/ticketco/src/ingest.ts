import { createDb, type Db } from '@hendingar/core/db';
import {
	ingestEach,
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { venues } from '@hendingar/core/schema';
import { fetchListing, parseListing, type FetchListing } from './api.ts';
import { SHOPS, listingUrl, type TicketcoShop } from './instances.ts';
import { isCancelled, isFailure, mapEvent } from './map.ts';
import { slugifyVenue } from '@hendingar/core/slug';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per shop per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
 *
 * No gone-upstream sweep (`@hendingar/core/gone-upstream`), deliberately. That is only safe where
 * one run sees everything a source publishes, and nothing here says the shop's listing does: it
 * shows what is on sale, and an event whose sale has closed or not yet opened may well be alive
 * and absent. Until that is measured, an event that disappears from the shop stays until its date.
 */

export type IngestOptions = RunOptions & { read?: FetchListing };

function upsertSource(db: Db, shop: TicketcoShop) {
	return registerSource(db, {
		slug: shop.slug,
		name: shop.name,
		url: listingUrl(shop),
		endpoint: listingUrl(shop),
		kind: 'html',
		/*
		 * Written on every run — the note describes how we collect a source, so the importer owns
		 * it. See `aktivitetforalle/src/ingest.ts` for what a stale one costs.
		 */
		note:
			'Billettbutikken til arrangøren på TicketCo. Vi les lista over arrangement éin gong om ' +
			'dagen. Klokka blir lesen av det sida viser folk: den maskinlesbare utgåva merkjer ' +
			'norsk tid som UTC, og ville flytta alt ein til to timar.',
		scheduleCron: shop.scheduleCron,
		iconUrl: shop.iconUrl,
		trusted: shop.trusted,
		region: shop.region,
		attribution: shop.attribution
	});
}

/** The shop's one venue, from the instance config — see `venue` in instances.ts for why. */
async function venueIdFor(db: Db, shop: TicketcoShop) {
	const { name, street, postalCode, municipality } = shop.venue;
	const slug = slugifyVenue(name);
	if (!slug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name,
			slug,
			address: street,
			postalCode,
			municipality,
			timezone: shop.timezone,
			// No coordinates anywhere in TicketCo's output, and we do not geocode (core/address.ts).
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({
			target: venues.slug,
			/*
			 * Filled in, never blanked: a row another source created under the same name keeps
			 * what it had, and gains the address and kommune this config knows.
			 */
			set: { name, address: street, postalCode, municipality }
		})
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestShop(
	connectionString: string,
	shop: TicketcoShop,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { read = fetchListing } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, shop);

	const report = await recordRun(db, source.id, options, async (run) => {
		let skipped = 0;

		const listing = parseListing(await read(shop));
		for (const problem of listing.rejected) run.reject(`invalid ld+json: ${problem}`);

		// Looked up once per run, not once per event: every event in a shop is in its one venue.
		const venueId = run.dryRun ? null : await venueIdFor(db, shop);
		const seen = new Set<string>();

		for (const entry of listing.listings) {
			/*
			 * Counted apart from `rejected`: nothing changed shape, it is an event a what's-on
			 * listing should not repeat. `rejected` has to go on meaning "the source moved".
			 */
			if (isCancelled(entry.event)) {
				skipped += 1;
				continue;
			}

			run.counts.fetched += 1;
			const mapped = mapEvent(entry.event, entry.slug, entry.card, shop);
			if (isFailure(mapped)) {
				run.reject(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}
			if (mapped.clockDisagreement) run.note(`${mapped.title}: ${mapped.clockDisagreement}`);
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
				venueId,
				ctaUrl: mapped.ctaUrl,
				posterUrl: mapped.posterUrl,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? 'published' : 'pending'
			});
		}

		// First and uncapped: the one line that explains why fetched is lower than the shop's count.
		if (skipped > 0) run.problems.unshift(`skipped ${skipped} cancelled event(s)`);
	});

	return { slug: shop.slug, ...report };
}

/**
 * Every configured shop. One failing shop must not stop the others — they are independent sources
 * that happen to share a parser, so a failure is recorded against that source alone.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	return ingestEach(SHOPS, (shop) => ingestShop(connectionString, shop, options));
}
