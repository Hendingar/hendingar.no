import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
import { fetchListing, parseListing, type FetchListing } from './api.ts';
import { SHOPS, listingUrl, type TicketcoShop } from './instances.ts';
import { isCancelled, isFailure, mapEvent, slugifyVenue } from './map.ts';

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

export type IngestResult = {
	runId: number;
	slug: string;
	status: 'success' | 'partial' | 'failed';
	fetched: number;
	created: number;
	updated: number;
	unchanged: number;
	rejected: number;
	durationMs: number;
	message: string | null;
};

export type IngestOptions = {
	read?: FetchListing;
	trigger?: string;
	revision?: string | null;
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db, shop: TicketcoShop) {
	const shared = {
		name: shop.name,
		url: listingUrl(shop),
		endpoint: listingUrl(shop),
		kind: 'html' as const,
		/*
		 * Written on every run — the note describes how we collect a source, so the importer owns
		 * it. See `aktivitetforalle/src/ingest.ts` for what a stale one costs.
		 */
		note:
			'Billettbutikken til arrangøren på TicketCo. Vi les lista over arrangement éin gong om ' +
			'dagen. Klokka blir lesen av det sida viser folk: den maskinlesbare utgåva merkjer ' +
			'norsk tid som UTC, og ville flytta alt ein til to timar.',
		/*
		 * Explicitly active: a source can arrive already existing as a `link` row, registered with
		 * `active: false`, and graduating it without flipping this back hides it from every count.
		 */
		active: true,
		scheduleCron: shop.scheduleCron,
		iconUrl: shop.iconUrl,
		trusted: shop.trusted
	};
	const [row] = await db
		.insert(sources)
		.values({ slug: shop.slug, region: shop.region, attribution: shop.attribution, ...shared })
		.onConflictDoUpdate({ target: sources.slug, set: shared })
		.returning();
	if (!row) throw new Error(`could not register the source ${shop.slug}`);
	return row;
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
	const {
		read = fetchListing,
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db, shop);

	/*
	 * A dry run opens no run row: the row is inserted as `running` and only closed on the success
	 * path, so opening one would leave /datasamling showing an import that never finished.
	 */
	let runId = -1;
	if (!dryRun) {
		const [run] = await db
			.insert(ingestRuns)
			.values({ sourceId: source.id, startedAt, status: 'running', trigger, revision })
			.returning({ id: ingestRuns.id });
		if (!run) throw new Error('could not open an ingest run');
		runId = run.id;
	}

	let fetched = 0;
	let created = 0;
	let updated = 0;
	let unchanged = 0;
	let rejected = 0;
	let skipped = 0;
	const problems: string[] = [];

	try {
		const listing = parseListing(await read(shop));
		for (const problem of listing.rejected) {
			rejected += 1;
			if (problems.length < 10) problems.push(`invalid ld+json: ${problem}`);
		}

		// Looked up once per run, not once per event: every event in a shop is in its one venue.
		const venueId = dryRun ? null : await venueIdFor(db, shop);
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

			fetched += 1;
			const mapped = mapEvent(entry.event, entry.slug, entry.card, shop);
			if (isFailure(mapped)) {
				rejected += 1;
				if (problems.length < 10)
					problems.push(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}
			if (mapped.clockDisagreement && problems.length < 10) {
				problems.push(`${mapped.title}: ${mapped.clockDisagreement}`);
			}
			if (seen.has(mapped.externalId)) continue;
			seen.add(mapped.externalId);

			if (dryRun) {
				created += 1;
				continue;
			}

			const values = {
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
				status: source.trusted ? ('published' as const) : ('pending' as const)
			};

			// Read before write, so a run reports what actually changed rather than marking every
			// event "updated" daily and burying the one day a source really moved.
			const [existing] = await db
				.select({
					id: events.id,
					title: events.title,
					description: events.description,
					category: events.category,
					startsAt: events.startsAt,
					endsAt: events.endsAt,
					venueId: events.venueId,
					ctaUrl: events.ctaUrl,
					posterUrl: events.posterUrl,
					posterRightsVerified: events.posterRightsVerified,
					status: events.status,
					sourceUrl: events.sourceUrl
				})
				.from(events)
				.where(and(eq(events.sourceId, source.id), eq(events.externalId, mapped.externalId)))
				.limit(1);

			if (!existing) {
				await db.insert(events).values(values);
				created += 1;
				continue;
			}

			const same =
				existing.title === values.title &&
				existing.description === values.description &&
				existing.category === values.category &&
				+existing.startsAt === +values.startsAt &&
				(existing.endsAt?.getTime() ?? null) === (values.endsAt?.getTime() ?? null) &&
				existing.venueId === values.venueId &&
				existing.ctaUrl === values.ctaUrl &&
				existing.posterUrl === values.posterUrl &&
				existing.posterRightsVerified === values.posterRightsVerified &&
				existing.status === values.status &&
				existing.sourceUrl === values.sourceUrl;

			if (same) {
				unchanged += 1;
				continue;
			}

			await db
				.update(events)
				.set({ ...values, updatedAt: now() })
				.where(eq(events.id, existing.id));
			updated += 1;
		}

		if (skipped > 0) problems.unshift(`skipped ${skipped} cancelled event(s)`);

		const status: IngestResult['status'] = rejected > 0 ? 'partial' : 'success';
		const finishedAt = now();
		const durationMs = finishedAt.getTime() - startedAt.getTime();
		const message = problems.length ? problems.join('; ').slice(0, 2000) : null;

		if (!dryRun) {
			await db
				.update(ingestRuns)
				.set({
					finishedAt,
					status,
					fetched,
					created,
					updated,
					unchanged,
					rejected,
					durationMs,
					message
				})
				.where(eq(ingestRuns.id, runId));
			await db.update(sources).set({ lastRunAt: finishedAt }).where(eq(sources.id, source.id));
		}

		return {
			runId,
			slug: shop.slug,
			status,
			fetched,
			created,
			updated,
			unchanged,
			rejected,
			durationMs,
			message
		};
	} catch (error) {
		const finishedAt = now();
		const message = error instanceof Error ? error.message : String(error);
		// Nothing to close if the run was never opened.
		if (dryRun) throw error;
		await db
			.update(ingestRuns)
			.set({
				finishedAt,
				status: 'failed',
				fetched,
				created,
				updated,
				unchanged,
				rejected,
				durationMs: finishedAt.getTime() - startedAt.getTime(),
				message: message.slice(0, 2000)
			})
			.where(eq(ingestRuns.id, runId));
		throw error;
	}
}

/**
 * Every configured shop. One failing shop must not stop the others — they are independent sources
 * that happen to share a parser, so a failure is recorded against that source alone.
 */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const results: IngestResult[] = [];
	for (const shop of SHOPS) {
		try {
			results.push(await ingestShop(connectionString, shop, options));
		} catch (error) {
			results.push({
				runId: -1,
				slug: shop.slug,
				status: 'failed',
				fetched: 0,
				created: 0,
				updated: 0,
				unchanged: 0,
				rejected: 0,
				durationMs: 0,
				message: error instanceof Error ? error.message : String(error)
			});
		}
	}
	return results;
}
