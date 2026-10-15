import { createDb, type Db } from '@hendingar/core/db';
import {
	ingestEach,
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { venues } from '@hendingar/core/schema';
import { readFeed, type ReadFeed } from './api.ts';
import { parseIcal } from './ical.ts';
import { TEAMS, feedUrl, teamUrl, type FotballTeam } from './teams.ts';
import { isFailure, isHomeMatch, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per team per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
 */

export type IngestOptions = RunOptions & { feed?: ReadFeed };

function upsertSource(db: Db, team: FotballTeam) {
	return registerSource(db, {
		slug: team.slug,
		name: team.name,
		url: teamUrl(team),
		endpoint: feedUrl(team),
		note: 'iCal-abonnementet til laget på fotball.no. Vi les heile kampprogrammet og tek berre heimekampane.',
		/*
		 * `feed`, not `json-api`. The first use of that enum value, and it is the honest one: this
		 * is an iCal subscription, and /datasamling says so publicly.
		 */
		kind: 'feed',
		scheduleCron: team.scheduleCron,
		iconUrl: team.iconUrl,
		trusted: team.trusted,
		region: team.region,
		attribution: team.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent, team: FotballTeam) {
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			municipality: null,
			timezone: team.timezone,
			// The feed names a ground, never a coordinate. Flagged rather than dropped, so an
			// unplaceable venue is visible to the geocoder instead of vanishing.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestTeam(
	connectionString: string,
	team: FotballTeam,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { feed = readFeed } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, team);

	const report = await recordRun(db, source.id, options, async (run) => {
		let away = 0;
		const parsed = parseIcal(await feed(team));
		const seen = new Set<string>();

		for (const raw of parsed) {
			/*
			 * Away fixtures.
			 *
			 * Counted separately from `rejected`: nothing changed shape, the match is simply
			 * somewhere else. `rejected` must go on meaning "the source moved".
			 */
			if (!isHomeMatch(raw, team)) {
				away += 1;
				continue;
			}

			run.counts.fetched += 1;
			const mapped = mapEvent(raw, team);
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

			await run.upsertEvent({
				sourceId: source.id,
				externalId: mapped.externalId,
				sourceUrl: mapped.sourceUrl,
				title: mapped.title,
				description: mapped.description,
				category: mapped.category,
				startsAt: mapped.startsAt,
				endsAt: mapped.endsAt,
				venueId: await venueIdFor(db, mapped, team),
				ctaUrl: mapped.ctaUrl,
				posterUrl: mapped.posterUrl,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? 'published' : 'pending'
			});
		}

		/*
		 * A feed that parsed but held nothing is a failure, not an empty season.
		 *
		 * Every one of these teams plays at home. Zero VEVENTs means NFF changed the feed or closed
		 * it, and reporting success would leave /datasamling showing a healthy source that has
		 * quietly stopped — the exact thing the runs table exists to catch.
		 */
		if (parsed.length === 0) throw new Error('the feed contained no VEVENTs');

		/*
		 * The away count is recorded even on a clean run: it is the only place the home-only rule
		 * is visible, and the number that moves if NFF respells the ground. Ahead of the problems,
		 * and outside their cap.
		 */
		if (away > 0) run.problems.unshift(`${away} away fixtures skipped`);
	});

	return { slug: team.slug, ...report };
}

/**
 * Every configured team. One failing feed must not stop the others — they are independent sources
 * that happen to share a parser, so a failure is recorded against that source alone.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	return ingestEach(TEAMS, (team) => ingestTeam(connectionString, team, options));
}
