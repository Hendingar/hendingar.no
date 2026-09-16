import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { curatorPicks, events, organizers, sources, venues } from '@hendingar/core/schema';
import { DEFAULT_TIME_ZONE, weekendAhead } from '@hendingar/core/datetime';
import { instantWindowForDays, localDayKey } from '../calendar.ts';
import { currentSelection } from '../kurator.ts';
import { db } from './db';
import { curateWeekend, verifierEnabled } from './verifier';

/**
 * The weekend's picks: chosen once a night, stored, and read by everybody afterwards.
 *
 * ## Why the app makes this call and not the nightly runner
 *
 * The verifier is the only place a model may run (ADR 0008) and its ingress is internal —
 * `infra/verifier.bicep`, `external: false` — because an unauthenticated `/extract` on a public URL
 * would be a free vision-model proxy for whoever found it. The nightly job is a GitHub runner that
 * reaches Postgres through a firewall rule it opens and closes around itself; it has no route into
 * the Container Apps environment at all. Something inside that environment has to place the call,
 * and the app already is that something. So the app exposes `POST /api/kurator` and the workflow
 * curls it. See ADR 0018.
 *
 * ## Why that endpoint can be open
 *
 * It takes no input and is idempotent per day. A second call finds the stored rows and returns
 * them without asking a model anything, so the ceiling is one curation a night no matter who finds
 * the URL — and because the selection depends on the date rather than on the caller, a stranger who
 * triggers it gets exactly the picks the cron would have produced, just earlier. That is a
 * different animal from the proxy ADR 0008 refused: there is nothing to steal, and nothing a caller
 * can steer.
 *
 * ## What the model is not told
 *
 * `candidates` carries no heart count, no view count, nothing about attention. The question is
 * which events are worth going out for, and `/poppis` already answers "what are people looking at"
 * honestly and separately. Keeping the numbers out of the payload is what makes that separation
 * real rather than a promise — see `services/verifier/src/verifier/kurator.py`.
 */

export type WeekendPick = {
	eventId: number;
	rank: number;
	reason: string;
	title: string;
	startsAt: Date;
	venueName: string | null;
	venueTimeZone: string;
	posterUrl: string | null;
};

/** Today where the events are. The picks belong to a day, so a day is what keys them. */
function today(): string {
	return localDayKey(new Date(), DEFAULT_TIME_ZONE);
}

/**
 * Everything on this weekend, in the same window `/denne-helga` shows.
 *
 * Deliberately the same helper rather than a second definition of "the weekend" — `weekendAhead`
 * drops the days that have already gone, so a selection made on Sunday morning cannot recommend
 * Friday's concert. A separate window here would eventually disagree with the page it appears on.
 */
async function candidates() {
	const now = new Date();
	const dates = weekendAhead(today());
	const { from, to } = instantWindowForDays(dates[0] ?? '', dates[dates.length - 1] ?? '');

	const rows = await db()
		.select({
			id: events.id,
			title: events.title,
			description: events.description,
			category: events.category,
			startsAt: events.startsAt,
			venueTimeZone: venues.timezone,
			venueName: venues.name,
			municipality: venues.municipality,
			organizerName: organizers.name,
			sourceName: sources.name
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.leftJoin(organizers, eq(events.organizerId, organizers.id))
		.leftJoin(sources, eq(events.sourceId, sources.id))
		.where(
			and(
				eq(events.status, 'published'),
				isNull(events.duplicateOfId),
				// A place that is open is not an event that happens (ADR 0013), and a kurator asked
				// what is worth going out for on Saturday must not answer with the library's
				// opening hours.
				eq(events.kind, 'dated'),
				gte(events.startsAt, from),
				lte(events.startsAt, to),
				or(gte(events.startsAt, now), gte(events.endsAt, now))
			)
		)
		.orderBy(asc(events.startsAt));

	/*
	 * Narrowed to the weekend at each venue's own clock — the same second step `weekendEvents`
	 * takes, and for the same reason.
	 *
	 * `instantWindowForDays` deliberately pads its window by a day either side, because a window
	 * built from instants is wider than three local days at the edges. The caller is expected to
	 * re-derive each row's day and drop what falls outside. Skipping that here offered the kurator
	 * eleven events for a weekend of five, Thursday's among them — and a pick it made from that
	 * list would have appeared above a listing which, correctly, did not contain it.
	 *
	 * Found by running the thing and counting, not by reading the query.
	 */
	return rows.filter((row) =>
		dates.includes(localDayKey(row.startsAt, row.venueTimeZone ?? DEFAULT_TIME_ZONE))
	);
}

/**
 * The picks a reader should see now: the most recent selection that is still about this weekend.
 *
 * **Not "today's selection", which is what this was and why it was wrong.** The rows are keyed by
 * the day the job ran, and the job runs on a GitHub `schedule` — nominally 05:00 UTC, in practice
 * landing nearer 10:00, because that scheduler is best-effort under load. Reading strictly by
 * today's date therefore emptied the section every midnight and refilled it around lunchtime, so
 * the one question this feature answers — "is anything worth going out for this weekend" — had no
 * answer every single morning. Reported from the live site, not caught here.
 *
 * So the newest selection stands until a newer one replaces it. What retires it is not a clock but
 * the weekend itself: every pick is filtered against `weekendAhead`, so a selection made on Monday
 * loses its Friday pick once Friday is over, and empties on its own when the weekend has passed.
 * Nothing needs to run for that to be true, which is the property worth having — the page is
 * correct even on a day the job never fires.
 */
export async function currentPicks(): Promise<WeekendPick[]> {
	const latest = await db()
		.select({ forDate: curatorPicks.forDate })
		.from(curatorPicks)
		.where(lte(curatorPicks.forDate, today()))
		.orderBy(desc(curatorPicks.forDate))
		.limit(1);

	const forDate = latest[0]?.forDate;
	if (!forDate) return [];

	/*
	 * Which of those rows to show is decided by `currentSelection`, which is pure and tested —
	 * `lib/kurator.spec.ts`. The SQL above narrows to one day's rows; the rule that says *which*
	 * day and which of its picks still stand is the part that was wrong in production, so it lives
	 * somewhere a test can ask it about any morning it likes.
	 */
	const rows = (await picksFor(forDate)).map((pick) => ({
		...pick,
		forDate,
		localDate: localDayKey(pick.startsAt, pick.venueTimeZone)
	}));

	return currentSelection(rows, today()).map((pick) => ({
		eventId: pick.eventId,
		rank: pick.rank,
		reason: pick.reason,
		title: pick.title,
		startsAt: pick.startsAt,
		venueName: pick.venueName,
		venueTimeZone: pick.venueTimeZone,
		posterUrl: pick.posterUrl
	}));
}

/**
 * The stored picks for one specific day, joined to what a card needs to render.
 *
 * Addressed by date because that is what the idempotency turns on — `curateToday` asks whether
 * *today* has already chosen. Readers want `currentPicks` instead.
 */
export async function picksFor(date: string): Promise<WeekendPick[]> {
	const rows = await db()
		.select({
			eventId: curatorPicks.eventId,
			rank: curatorPicks.rank,
			reason: curatorPicks.reason,
			title: events.title,
			startsAt: events.startsAt,
			venueName: venues.name,
			venueTimeZone: venues.timezone,
			posterUrl: events.posterUrl,
			status: events.status,
			duplicateOfId: events.duplicateOfId
		})
		.from(curatorPicks)
		.innerJoin(events, eq(curatorPicks.eventId, events.id))
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(eq(curatorPicks.forDate, date))
		.orderBy(asc(curatorPicks.rank));

	/*
	 * Filtered on read, never deleted.
	 *
	 * An event can be unpublished or marked a duplicate after it was picked, and the pick is still
	 * a true record of what the kurator chose from what it was shown. Dropping the row would lose
	 * that; showing it would put an unpublished event on a page. So the row stays and the listing
	 * does not — which also means a weekend can honestly end up with two picks on screen.
	 */
	return rows
		.filter((row) => row.status === 'published' && row.duplicateOfId === null)
		.map((row) => ({
			eventId: row.eventId,
			rank: row.rank,
			reason: row.reason,
			title: row.title,
			startsAt: row.startsAt,
			venueName: row.venueName,
			// A venue without a zone is formatted in the pilot's, which is what every other listing
			// does. Never the server's or the browser's — that silently shifts concerts by an hour.
			venueTimeZone: row.venueTimeZone ?? DEFAULT_TIME_ZONE,
			posterUrl: row.posterUrl
		}));
}

export type CurationOutcome = {
	forDate: string;
	picks: number;
	considered: number;
	note: string;
	/** True when this call did the choosing; false when it found a selection already made. */
	fresh: boolean;
};

/**
 * Make today's selection, or report the one already made.
 *
 * The idempotency is the cost control and it is checked first, before anything is read and long
 * before a model is reached. Two calls a minute apart cost one curation; a hundred cost one.
 */
export async function curateToday(): Promise<CurationOutcome> {
	const forDate = today();

	const existing = await picksFor(forDate);
	if (existing.length > 0) {
		return {
			forDate,
			picks: existing.length,
			considered: 0,
			note: 'Utvalet for i dag var alt gjort.',
			fresh: false
		};
	}

	if (!verifierEnabled()) {
		return {
			forDate,
			picks: 0,
			considered: 0,
			note: 'Kuratoren er ikkje slått på her.',
			fresh: false
		};
	}

	const rows = await candidates();

	/*
	 * Never throws, for the same reason `verifyEvent` does not: an unreachable verifier must not
	 * become a failure somewhere that matters. Here "somewhere that matters" is a red nightly
	 * build about fifteen sources that imported perfectly, and a weekend page that renders exactly
	 * as it did before the kurator existed is the correct degraded state.
	 */
	let selection;
	try {
		selection = await curateWeekend(
			rows.map((row) => ({
				id: row.id,
				title: row.title,
				description: row.description,
				category: row.category,
				startsAt: row.startsAt.toISOString(),
				venueName: row.venueName,
				municipality: row.municipality,
				organizerName: row.organizerName,
				sourceName: row.sourceName
			}))
		);
	} catch (error) {
		console.warn(`[kurator] unavailable: ${error instanceof Error ? error.message : error}`);
		return {
			forDate,
			picks: 0,
			considered: rows.length,
			note: 'Kuratoren var ikkje tilgjengeleg. Ingenting er lagra, så neste køyring prøver på nytt.',
			fresh: false
		};
	}

	if (selection.picks.length > 0) {
		await db()
			.insert(curatorPicks)
			.values(
				selection.picks.map((pick) => ({
					forDate,
					eventId: pick.eventId,
					rank: pick.rank,
					reason: pick.reason,
					model: selection.model
				}))
			)
			/*
			 * Two calls that raced past the check above must not both write. The unique index on
			 * (for_date, event_id) is what decides it, and the loser does nothing rather than
			 * failing — either way the day ends with one selection.
			 */
			.onConflictDoNothing();
	}

	return {
		forDate,
		picks: selection.picks.length,
		considered: selection.considered,
		note: selection.note,
		fresh: true
	};
}
