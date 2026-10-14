import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { markGoneUpstream } from '@hendingar/core/gone-upstream';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
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
	read?: ReadSchedule;
	trigger?: string;
	revision?: string | null;
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db, team: HandballTeam) {
	const shared = {
		name: team.name,
		url: teamUrl(team),
		endpoint: teamUrl(team),
		note: 'Terminlista til laget på handball.no, med løyve frå Norges Håndballforbund. Vi les heile sesongen og tek berre heimekampane.',
		kind: 'json-api' as const,
		active: true,
		scheduleCron: team.scheduleCron,
		iconUrl: team.iconUrl,
		trusted: team.trusted
	};
	const [row] = await db
		.insert(sources)
		.values({ slug: team.slug, region: team.region, attribution: team.attribution, ...shared })
		.onConflictDoUpdate({ target: sources.slug, set: shared })
		.returning();
	if (!row) throw new Error(`could not register the source ${team.slug}`);
	return row;
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
	const {
		read = readSchedule,
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db, team);

	// A dry run opens no run row: one opened and never closed shows as an import still running.
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
	let away = 0;
	let unscheduled = 0;
	let calledOff = 0;
	const problems: string[] = [];

	try {
		const schedule = await read(team);
		for (const problem of schedule.rejected) {
			rejected += 1;
			if (problems.length < 10) problems.push(`invalid schedule row: ${problem}`);
		}

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

			fetched += 1;
			const mapped = mapEvent(raw, team);
			if (isFailure(mapped)) {
				rejected += 1;
				if (problems.length < 10) problems.push(`${mapped.title}: ${mapped.problem}`);
				continue;
			}
			if (seen.has(mapped.externalId)) continue;
			seen.add(mapped.externalId);

			if (dryRun) {
				created += 1;
				continue;
			}

			const venueId = await venueIdFor(db, mapped, team);

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
			// event "updated" daily and burying the one day a match really moved.
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
		if (!dryRun) {
			swept = await markGoneUpstream(db, { sourceId: source.id, seen: present, now: now() });
		}

		const status: IngestResult['status'] = rejected > 0 ? 'partial' : 'success';
		const finishedAt = now();
		const durationMs = finishedAt.getTime() - startedAt.getTime();
		const notes = [
			away > 0 ? `${away} away matches skipped` : null,
			unscheduled > 0 ? `${unscheduled} without a time yet` : null,
			calledOff > 0 ? `${calledOff} cancelled or postponed` : null,
			swept.marked > 0 ? `${swept.marked} no longer listed by the source` : null,
			swept.restored > 0 ? `${swept.restored} listed again` : null,
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
			slug: team.slug,
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
 * Every configured team. One failing team must not stop the others — they are independent sources
 * that happen to share a parser, so a failure is recorded against that source alone.
 */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const results: IngestResult[] = [];
	for (const team of TEAMS) {
		try {
			results.push(await ingestTeam(connectionString, team, options));
		} catch (error) {
			results.push({
				runId: -1,
				slug: team.slug,
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
