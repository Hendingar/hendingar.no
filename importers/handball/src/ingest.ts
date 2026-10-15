import { createDb, type Db } from '@hendingar/core/db';
import { markGoneUpstream } from '@hendingar/core/gone-upstream';
import {
	ingestEach,
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { venues } from '@hendingar/core/schema';
import { readSchedule, type ReadSchedule } from './api.ts';
import { TEAMS, teamUrl, type HandballTeam } from './teams.ts';
import {
	isFailure,
	isGoingAhead,
	isHomeMatch,
	isUnscheduled,
	mapEvent,
	type MappedEvent
} from './map.ts';

/**
 * Deterministic: fetch → validate → map → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per team per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
 */

export type IngestOptions = RunOptions & { read?: ReadSchedule };

function upsertSource(db: Db, team: HandballTeam) {
	return registerSource(db, {
		slug: team.slug,
		name: team.name,
		url: teamUrl(team),
		endpoint: teamUrl(team),
		note: 'Terminlista til laget på handball.no, med løyve frå Norges Håndballforbund. Vi les heile sesongen og tek berre heimekampane.',
		kind: 'json-api',
		scheduleCron: team.scheduleCron,
		iconUrl: team.iconUrl,
		trusted: team.trusted,
		region: team.region,
		attribution: team.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent, team: HandballTeam) {
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			municipality: null,
			timezone: team.timezone,
			// The schedule names a hall, never a coordinate. Flagged rather than dropped, so an
			// unplaceable venue is visible to the geocoder instead of vanishing.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestTeam(
	connectionString: string,
	team: HandballTeam,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { read = readSchedule } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, team);

	const report = await recordRun(db, source.id, options, async (run) => {
		let away = 0;
		let unscheduled = 0;
		let calledOff = 0;

		const schedule = await read(team);
		for (const problem of schedule.rejected) run.reject(`invalid schedule row: ${problem}`);

		const seen = new Set<string>();
		/*
		 * Every home match handball.no still lists as going ahead, mapped or not.
		 *
		 * The sweep reads this, not `seen`: a match with no time yet is still on the schedule, and
		 * must not be taken out of the listing because we declined to map it.
		 */
		const present = new Set<string>();

		for (const raw of schedule.matches) {
			// Counted apart from `rejected`, which must go on meaning "the source moved".
			if (!isHomeMatch(raw, team)) {
				away += 1;
				continue;
			}
			if (!isGoingAhead(raw)) {
				calledOff += 1;
				continue;
			}
			present.add(String(raw.matchId));
			if (isUnscheduled(raw)) {
				unscheduled += 1;
				continue;
			}

			run.counts.fetched += 1;
			const mapped = mapEvent(raw, team);
			if (isFailure(mapped)) {
				run.reject(`${mapped.title}: ${mapped.problem}`);
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
		 * A schedule with no matches at all is a failure, not an empty season.
		 *
		 * Both teams play a full league. Zero rows means the endpoint changed or the season id
		 * pointed somewhere empty, and reporting success would leave /datasamling showing a
		 * healthy source that has quietly stopped.
		 */
		if (schedule.matches.length === 0) throw new Error('the schedule contained no matches');

		/*
		 * Cancelled and postponed matches leave the listing. Safe because one response is the
		 * team's whole season — nothing is read through a window — and nothing is deleted.
		 */
		let swept = { marked: 0, restored: 0 };
		if (!run.dryRun) {
			swept = await markGoneUpstream(db, { sourceId: source.id, seen: present, now: run.now() });
		}

		// The run's own summary, ahead of the problems and outside their cap.
		const summary: string[] = [];
		if (away > 0) summary.push(`${away} away matches skipped`);
		if (unscheduled > 0) summary.push(`${unscheduled} without a time yet`);
		if (calledOff > 0) summary.push(`${calledOff} cancelled or postponed`);
		if (swept.marked > 0) summary.push(`${swept.marked} no longer listed by the source`);
		if (swept.restored > 0) summary.push(`${swept.restored} listed again`);
		run.problems.unshift(...summary);
	});

	return { slug: team.slug, ...report };
}

/**
 * Every configured team. One failing team must not stop the others — they are independent sources
 * that happen to share a parser, so a failure is recorded against that source alone.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	return ingestEach(TEAMS, (team) => ingestTeam(connectionString, team, options));
}
