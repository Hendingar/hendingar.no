import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import {
	ingestEach,
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { events, venues } from '@hendingar/core/schema';
import {
	ENDPOINT,
	createPacer,
	fetchAll,
	parseDetail,
	readDetail,
	readEvents,
	wait,
	type Pace,
	type ReadDetail,
	type ReadEvents,
	type UpstreamDetail,
	type Wait
} from './api.ts';
import { ORGANISERS, organiserUrl, type AlleventsOrganiser } from './organisers.ts';
import { cleanEventUrl, isFailure, mapEvent, preferDescription, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per organiser per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale. Four
 * organisers therefore produce four rows and four lines on the page, not one combined run. They
 * share an `endpoint`, which is what marks them as one platform.
 */

export type IngestOptions = RunOptions & {
	readEvents?: ReadEvents;
	readDetail?: ReadDetail;
	/** Injected so tests wait for nothing — see `Wait` in api.ts. */
	wait?: Wait;
	pace?: Pace;
};

function upsertSource(db: Db, organiser: AlleventsOrganiser) {
	return registerSource(db, {
		slug: organiser.slug,
		name: organiser.name,
		url: organiserUrl(organiser),
		endpoint: ENDPOINT,
		kind: 'json-api',
		note:
			'Arrangøren har ei opa side på allevents.in. Vi les det same JSON-kallet som sida deira ' +
			'sjølv gjer, filtrert på denne arrangøren, og hentar omtalen frå sida til kvar hending.',
		scheduleCron: organiser.scheduleCron,
		iconUrl: organiser.iconUrl,
		trusted: organiser.trusted,
		region: organiser.region,
		// Attributed to the organiser, not the directory: these are their events, and allevents.in
		// is where they happen to be readable without a Facebook account.
		attribution: organiser.name
	});
}

/** The description already stored for this event, which `preferDescription` may keep. */
async function storedDescription(db: Db, sourceId: number, externalId: string) {
	const [row] = await db
		.select({ description: events.description })
		.from(events)
		.where(and(eq(events.sourceId, sourceId), eq(events.externalId, externalId)))
		.limit(1);
	return row?.description ?? null;
}

async function venueIdFor(db: Db, mapped: MappedEvent, organiser: AlleventsOrganiser) {
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			/*
			 * Not filled in, deliberately.
			 *
			 * `venue.city` is empty for three of the four organisers and wrong for the fourth — Sagvåg
			 * Bygdalag's hall in Sagvåg is filed under "Ølen", forty kilometres away — and
			 * `venue.state` says "RO" for every Norwegian event. The only place a real place name
			 * appears is inside `street` ("… 5410 Sagvåg, Norge"), and that is a postal town, which is
			 * not a municipality: Leirvik is in Stord and Svortland is in Bømlo. Writing a postal town
			 * into a column called `municipality` would be wrong in a way nothing downstream could
			 * detect, so it is left null for the geocoder to fill properly.
			 */
			municipality: null,
			address: mapped.venueAddress.street,
			postalCode: mapped.venueAddress.postalCode,
			timezone: organiser.timezone,
			// allevents.in does publish coordinates, and they look right. Geocoding is a separate
			// concern with its own status column, and no importer here writes them — flagged rather
			// than half-filled, the same call `importers/billetto` made.
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

export async function ingestOrganiser(
	connectionString: string,
	organiser: AlleventsOrganiser,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const {
		readEvents: listing = readEvents,
		readDetail: detail = readDetail,
		wait: waitFor = wait,
		pace = createPacer(waitFor)
	} = options;

	const db = createDb(connectionString);
	const source = await upsertSource(db, organiser);

	const report = await recordRun(db, source.id, options, async (run) => {
		const parsed = await fetchAll(organiser, listing, pace);
		for (const problem of parsed.rejected) run.reject(`invalid record: ${problem}`);

		const seen = new Set<string>();

		for (const raw of parsed.events) {
			run.counts.fetched += 1;

			/*
			 * The description lives only on the event's own page, and that is one HTTP request per
			 * event. A failure there is not a failure of the event — we still have its title, time,
			 * place, category and poster from the endpoint — so it degrades to an event without a
			 * description rather than losing the row, and rather than losing the other seven.
			 *
			 * The failure is *reported*, though: it lands in the run's message and turns the run
			 * `partial`, so a page that has started 500ing for everyone is visible on /datasamling
			 * instead of showing up as descriptions quietly going missing.
			 */
			let detailData: UpstreamDetail | null = null;
			let detailFailed = false;
			/*
			 * The same normalisation the stored `sourceUrl` gets, and for the same two reasons: the
			 * path carries the organiser's own ø and å and must be percent-encoded, and any `?ref=`
			 * has to come off before we request it — robots.txt disallows those explicitly.
			 */
			const detailUrl = cleanEventUrl(raw.event_url);
			try {
				if (!detailUrl) throw new Error(`unusable event_url: ${raw.event_url}`);
				await pace();
				detailData = parseDetail(await detail(detailUrl));
			} catch (error) {
				detailFailed = true;
				run.reject(
					`detail for ${detailUrl ?? raw.event_url} failed: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}

			const mapped = mapEvent(raw, detailData, organiser);
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

			const venueId = await venueIdFor(db, mapped, organiser);

			/*
			 * A description we already hold is never thrown away for a degraded copy — not for a page
			 * that 500'd, and not for the stripped template allevents.in serves at random. The rule
			 * and the measurements behind it live in `preferDescription`.
			 */
			const description = preferDescription(
				await storedDescription(db, source.id, mapped.externalId),
				mapped.description,
				{ failed: detailFailed, truncated: detailData?.truncated ?? false }
			);

			await run.upsertEvent({
				sourceId: source.id,
				externalId: mapped.externalId,
				sourceUrl: mapped.sourceUrl,
				title: mapped.title,
				description,
				category: mapped.category,
				startsAt: mapped.startsAt,
				endsAt: mapped.endsAt,
				venueId,
				ctaUrl: mapped.ctaUrl,
				posterUrl: mapped.posterUrl,
				posterSrcset: mapped.posterSrcset,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? 'published' : 'pending'
			});
		}

		/*
		 * An empty programme is recorded in words, because the counts alone cannot tell it apart from
		 * a run that read a response and understood nothing. A club between seasons legitimately has
		 * nothing on, and `parsePage` has already refused anything that was not a well-formed success
		 * — so this is a fact about the organiser rather than a warning about the code. Ahead of the
		 * problems and outside their cap, as it always was.
		 */
		if (run.counts.fetched === 0) run.problems.unshift('the organiser lists no upcoming events');
	});

	return { slug: organiser.slug, ...report };
}

/**
 * Every configured organiser. One failing profile must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 *
 * The pacer is created once and shared, so the crawl delay is honoured across the whole run and not
 * restarted for each organiser: as far as allevents.in is concerned this is one crawler.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const pace = options.pace ?? createPacer(options.wait ?? wait);
	return ingestEach(ORGANISERS, (organiser) =>
		ingestOrganiser(connectionString, organiser, { ...options, pace })
	);
}
