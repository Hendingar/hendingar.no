import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
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
	readEvents?: ReadEvents;
	readDetail?: ReadDetail;
	/** Injected so tests wait for nothing — see `Wait` in api.ts. */
	wait?: Wait;
	pace?: Pace;
	trigger?: string;
	revision?: string | null;
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db, shop: HooplaShop) {
	const shared = {
		name: shop.name,
		url: listingUrl(shop),
		endpoint: eventsUrl(shop),
		kind: 'json-api' as const,
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
		/*
		 * Explicitly active.
		 *
		 * A source can arrive here already existing as a `link` row, which the directory registers
		 * with `active: false` because nothing was collecting it. Graduating it without flipping
		 * this back leaves a source that publishes events while being excluded from every count
		 * that means "places this list comes from" — visible on the page, invisible in the numbers.
		 */
		active: true,
		scheduleCron: shop.scheduleCron,
		iconUrl: shop.iconUrl,
		trusted: shop.trusted
	};
	const [row] = await db
		.insert(sources)
		.values({
			slug: shop.slug,
			region: shop.region,
			attribution: shop.attribution,
			...shared
		})
		.onConflictDoUpdate({ target: sources.slug, set: shared })
		.returning();
	if (!row) throw new Error(`could not register the source ${shop.slug}`);
	return row;
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
		pace = createPacer(waitFor),
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db, shop);

	// A dry run opens no run row: the row is inserted as `running` and only closed on the success
	// path, so opening one would leave /datasamling showing an import that never finished.
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
	let describedFailures = 0;
	const problems: string[] = [];

	try {
		await pace();
		const parsed = parseEvents(await fetchEvents(shop));
		for (const problem of parsed.rejected) {
			rejected += 1;
			if (problems.length < 10) problems.push(`invalid event: ${problem}`);
		}

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
			fetched += 1;
			const mapped = mapEvent(event, shop);
			if (isFailure(mapped)) {
				rejected += 1;
				if (problems.length < 10) {
					problems.push(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				}
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
					if (problems.length < 10) {
						const why = error instanceof Error ? error.message : String(error);
						problems.push(`no description for ${mapped.externalId}: ${why}`);
					}
				}
			}

			if (dryRun) {
				created += 1;
				continue;
			}

			const venueId = await venueIdFor(db, mapped);

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

		const status: IngestResult['status'] = rejected > 0 ? 'partial' : 'success';
		const finishedAt = now();
		const durationMs = finishedAt.getTime() - startedAt.getTime();
		const notes = [
			skipped > 0 ? `${skipped} cancelled events skipped` : null,
			/*
			 * A missing description is not a partial run — the event imported. It is still worth a
			 * line on /datasamling, because "every description stopped arriving" is what a moved
			 * detail endpoint looks like from here.
			 */
			describedFailures > 0 ? `${describedFailures} descriptions unavailable` : null,
			publishable.length > MAX_DETAILS
				? `${publishable.length - MAX_DETAILS} events imported without a description (over the ${MAX_DETAILS} detail budget)`
				: null,
			...problems
		].filter(Boolean);
		const message = notes.length ? notes.join('; ').slice(0, 2000) : null;

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
 *
 * The pacer is created once and shared, so the crawl delay holds across the whole run rather than
 * resetting per shop.
 */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const pace = options.pace ?? createPacer(options.wait ?? wait);
	const results: IngestResult[] = [];
	for (const shop of SHOPS) {
		try {
			results.push(await ingestShop(connectionString, shop, { ...options, pace }));
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
