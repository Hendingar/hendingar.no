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
	monthsFrom,
	parseMonth,
	parsePoster,
	readDetail,
	readMonth,
	type ReadDetail,
	type ReadMonth
} from './api.ts';
import { CAMPUSES, calendarUrl, type HvlCampus } from './campuses.ts';
import { isAtCampus, isFailure, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per campus per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
 */

export type IngestOptions = RunOptions & {
	month?: ReadMonth;
	detail?: ReadDetail;
};

function upsertSource(db: Db, campus: HvlCampus) {
	return registerSource(db, {
		slug: campus.slug,
		name: campus.name,
		url: calendarUrl(campus),
		endpoint: `https://www.hvl.no/service/calendar/month/nn-NO/{year}/{month}/0/${campus.locationId}`,
		note: 'JSON per månad frå kalendertenesta til hvl.no. Kalenderen er nasjonal, så vi filtrerer ned til denne campusen og hentar plakaten frå sida til kvar hending.',
		kind: 'json-api',
		scheduleCron: campus.scheduleCron,
		iconUrl: campus.iconUrl,
		trusted: campus.trusted,
		region: campus.region,
		attribution: campus.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent, campus: HvlCampus) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			municipality: null,
			timezone: campus.timezone,
			// The calendar gives a room, never a coordinate. Flagged rather than dropped, so an
			// unplaceable venue is visible to the geocoder instead of vanishing.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestCampus(
	connectionString: string,
	campus: HvlCampus,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { month = readMonth, detail = readDetail } = options;

	const db = createDb(connectionString);
	const source = await upsertSource(db, campus);

	const report = await recordRun(db, source.id, options, async (run) => {
		let elsewhere = 0;

		/*
		 * One request per month. The service has no "everything from here" mode — the Angular
		 * controller pages a month at a time and so must we.
		 */
		const seen = new Set<string>();
		for (const { year, month: m } of monthsFrom(run.now())) {
			const parsed = parseMonth(await month(campus, year, m));
			for (const problem of parsed.rejected) run.reject(`invalid item: ${problem}`);

			for (const raw of parsed.events) {
				/*
				 * Tagged with this campus, but is it HERE?
				 *
				 * HVL tags an all-institution event with every campus, so the Stord filter returns
				 * the doctoral ceremony in Bergen and every Zoom webinar. Counted rather than
				 * treated as a rejection: nothing changed shape, these are simply somebody else's
				 * events, and `rejected` is the number that should mean "the source moved".
				 */
				if (!isAtCampus(raw, campus)) {
					elsewhere += 1;
					continue;
				}

				run.counts.fetched += 1;

				const first = mapEvent(raw, campus, null);
				if (isFailure(first)) {
					run.reject(`${first.title || first.externalId}: ${first.problem}`);
					continue;
				}
				if (seen.has(first.externalId)) continue;
				seen.add(first.externalId);

				/*
				 * The banner lives on the detail page and nowhere else. A failure there costs us a
				 * picture, not the event, so it degrades to no poster rather than losing the row.
				 */
				let poster: string | null = null;
				if (first.detailUrl) {
					try {
						poster = parsePoster(await detail(first.detailUrl));
					} catch (error) {
						run.note(
							`poster for ${first.externalId} failed: ${error instanceof Error ? error.message : String(error)}`
						);
					}
				}
				const mapped = { ...first, posterUrl: poster };

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
					venueId: await venueIdFor(db, mapped, campus),
					ctaUrl: mapped.ctaUrl,
					posterUrl: mapped.posterUrl,
					posterRightsVerified: mapped.posterRightsVerified,
					status: source.trusted ? 'published' : 'pending'
				});
			}
		}

		/*
		 * The count of other-campus rows is recorded even on a clean run, ahead of the capped
		 * problems and outside the cap.
		 *
		 * It is the one number that shows the location filter is doing its job, and the one that
		 * moves if HVL changes how it tags. A run that suddenly skips nothing, or skips everything,
		 * is visible on /datasamling instead of being a silent change in what we publish.
		 */
		if (elsewhere > 0) {
			run.problems.unshift(`${elsewhere} rows tagged ${campus.locationId} but held elsewhere`);
		}
	});

	return { slug: campus.slug, ...report };
}

/**
 * Every configured campus. One failing calendar must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	return ingestEach(CAMPUSES, (campus) => ingestCampus(connectionString, campus, options));
}
