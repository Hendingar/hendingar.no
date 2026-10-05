import { and, asc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { events, organizers, venues } from '@hendingar/core/schema';
import { categoryLabel } from '@hendingar/core/taxonomy';
import { COMPARE_MAX_EVENTS, type PileScore } from '@hendingar/core/validation';
import { AnswerCache, Budget, answer, type PileAnswer, type PileCandidate } from './pile-answer.ts';
import { db } from './db';
import { datedOnly, matchesSearch, sourceMarksFor, stillListed } from './listing.ts';
import { comparePile, rankForQuery } from './verifier.ts';
import { whenWords } from '../haugen.ts';

/**
 * The server half of `/haugen`: which events are in the pile, and how a question is answered.
 *
 * A question costs a TypeSafe call (ADR 0022), so three things stand between a keystroke and that
 * call, in order: a cache, a budget, and a fallback. None of them knows who is asking. There is no
 * per-visitor limit because a per-visitor limit needs a visitor id, and the README's line on
 * search terms — "nothing joinable back to a person" — holds for the server as well as the
 * analytics.
 */

/**
 * How many events make the pile.
 *
 * The nearest 120 different events (`pileIds`), which is a week and a half or more here. Tokens are paid per event asked about, so
 * this number IS the cost of a question: 120 is two requests of sixty (the verifier's chunk) and
 * about 34k tokens, down from three requests and ~42k at 150. The page shows as many balls as fit
 * and keeps the rest for the ranking, so an answer from next weekend can still float into view.
 */
export const PILE_SIZE = 120;

/**
 * Which events make the pile: the nearest 120 *different* ones.
 *
 * Collapsed on title and venue, keeping each one's next occurrence. A count of rows in date order
 * is not a count of things to do: once the cinema and the swimming pool were imported, the
 * nearest 120 rows were six days long — 31 public bathing sessions, ten screenings of one film —
 * and held not one concert, so "konsert" was answered, correctly, with nothing. A repeat is one
 * ball; the slots it gives back go to next week.
 */
async function pileIds(): Promise<number[]> {
	const sameThing = sql`lower(${events.title})`;
	const next = db()
		.selectDistinctOn([sameThing, events.venueId], { id: events.id, startsAt: events.startsAt })
		.from(events)
		.where(upcoming())
		.orderBy(sameThing, events.venueId, asc(events.startsAt), asc(events.id))
		.as('next');
	const rows = await db()
		.select({ id: next.id })
		.from(next)
		.orderBy(asc(next.startsAt), asc(next.id))
		.limit(PILE_SIZE);
	return rows.map((r) => r.id);
}

export async function pileEvents() {
	const ids = await pileIds();
	if (ids.length === 0) return [];
	const rows = await db()
		.select({
			id: events.id,
			title: events.title,
			category: events.category,
			description: events.description,
			startsAt: events.startsAt,
			venueName: venues.name,
			venueTimeZone: venues.timezone,
			municipality: venues.municipality,
			organizerName: organizers.name,
			posterUrl: events.posterUrl,
			posterSrcset: events.posterSrcset,
			sourceMarks: sourceMarksFor(events.id).as('source_marks'),
			// The wall clock at the venue, for the words the ranker is told. Resolved in the
			// database with the venue's zone, so a server in UTC cannot shift "kveld" to
			// "ettermiddag" (CLAUDE.md, "A timestamptz is an instant").
			localDate: sql<string>`
				to_char(${events.startsAt} at time zone coalesce(${venues.timezone}, 'Europe/Oslo'), 'YYYY-MM-DD')
			`.as('local_date'),
			localHour: sql<number>`
				extract(hour from ${events.startsAt} at time zone coalesce(${venues.timezone}, 'Europe/Oslo'))::int
			`.as('local_hour')
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.leftJoin(organizers, eq(events.organizerId, organizers.id))
		.where(inArray(events.id, ids))
		.orderBy(asc(events.startsAt), asc(events.id));
	return rows;
}

export type PileEvent = Awaited<ReturnType<typeof pileEvents>>[number];

/** The same rows `/hendingar` lists: published, still listed, canonical, dated, not over. */
function upcoming() {
	const now = new Date();
	return and(
		eq(events.status, 'published'),
		stillListed,
		isNull(events.duplicateOfId),
		datedOnly,
		or(gte(events.startsAt, now), gte(events.endsAt, now))
	);
}

export function candidateOf(event: PileEvent): PileCandidate {
	return {
		id: event.id,
		title: event.title,
		categoryLabel: categoryLabel(event.category),
		when: whenWords(event.localDate, event.localHour),
		venueName: event.venueName,
		municipality: event.municipality,
		organizerName: event.organizerName,
		description: event.description
	};
}

/**
 * Plain text matching over the same pile: 1 for a row that contains every word, 0 for one that
 * does not. What a visitor gets without the ranker, and what a GET with `?q=` always gets.
 */
export async function textScores(q: string, ids: readonly number[]): Promise<PileScore[]> {
	if (ids.length === 0) return [];
	const hits = await db()
		.select({ id: events.id })
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.leftJoin(organizers, eq(events.organizerId, organizers.id))
		.where(and(inArray(events.id, [...ids]), matchesSearch(q)));
	const matched = new Set(hits.map((h) => h.id));
	return ids.map((id) => ({ eventId: id, score: matched.has(id) ? 1 : 0 }));
}

const cache = new AnswerCache();
const budget = new Budget(60, Date.now());

/** The production wiring: the verifier's ranker, the database's text match, the wall clock. */
export function askPile(
	q: string,
	pile: readonly PileEvent[],
	withinVisitorShare = true
): Promise<PileAnswer> {
	return answer(q, pile, {
		cache,
		// The visitor's share is checked first, so a refused visitor spends nothing of the site's.
		budget: { take: (now) => withinVisitorShare && budget.take(now) },
		candidate: candidateOf,
		rank: rankForQuery,
		text: textScores,
		now: Date.now
	});
}

/**
 * Jev against the chat model on events from the pile — three, or up to sixty — for the comparison
 * on the page.
 *
 * Only ids that are in the pile right now: the button sends ids, and a caller is not allowed to
 * use this to have arbitrary rows judged. It spends from the same budget as a question, because
 * it costs at least as much — one Jev request and one chat-model call.
 */
export async function compareOnPile(q: string, ids: readonly number[]) {
	const pile = await pileEvents();
	const chosen = pile.filter((e) => ids.includes(e.id)).slice(0, COMPARE_MAX_EVENTS);
	if (chosen.length === 0) return { status: 'ukjende' as const };
	if (!budget.take(Date.now())) return { status: 'budsjett' as const };
	const result = await comparePile(q, chosen.map(candidateOf));
	return result ? { status: 'ok' as const, result } : { status: 'utan-modell' as const };
}
