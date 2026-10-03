/**
 * The pile on `/haugen`, as rules rather than pixels.
 *
 * Pure and shared by both ends: the server words an event's time for the ranker, and the page
 * turns a score into how hard a ball floats. No clock, no randomness, no DOM — `pile-physics.ts`
 * is where the motion lives, and it is told only what this module decides.
 */

import { WEEKDAY_NAMES, weekdayIndex } from '@hendingar/core/datetime';

/**
 * At or above this an event *is* an answer: it floats to the top, and is listed under the pile.
 *
 * Measured against jev-1.13 on 150 real events (services/verifier/evals/haugen): every event a
 * person would call a right answer scored 0.55 or more, and nonsense queries kept every event
 * under 0.15. The eval reads the same two numbers; move them together.
 */
export const FLOAT = 0.5;

/**
 * Below this an event sinks and dims. Between the two it stays in the heap at full colour.
 *
 * The middle band is where Jev is honestly unsure ("ting å gjere ute" and a football match), so it
 * is neither floated as an answer nor greyed out as a non-answer.
 */
export const SINK = 0.35;

/**
 * How hard a ball is pushed up, 0 to 1, for a score.
 *
 * Only answers float. The first version also lifted the unsure band a little, and on screen that
 * read as balls drifting aimlessly through the middle of the stage — noise, not nuance. The unsure
 * ones stay in the heap at full colour; the sunk ones dim. Above `FLOAT` the push grows with the
 * score, so the strongest answers win the race to the top and settle above the merely good ones,
 * which is how the pile shows its ranking without a number on every ball.
 */
export function buoyancy(score: number): number {
	if (score < FLOAT) return 0;
	return Math.min(1, 0.4 + (0.6 * (score - FLOAT)) / (0.9 - FLOAT));
}

/**
 * The part of the day, in the words somebody would type: "laurdag kveld", not "19:00".
 *
 * Jev reads a time as text and is documented as poor at comparing them, so a query like "noko på
 * laurdag" can only work if the event says "laurdag". The hour is already the venue's wall clock
 * — the caller resolves it in the venue's zone, never the server's.
 */
export function whenWords(localDate: string, localHour: number): string {
	const day = WEEKDAY_NAMES[weekdayIndex(localDate)];
	const part =
		localHour < 10
			? 'morgon'
			: localHour < 12
				? 'formiddag'
				: localHour < 17
					? 'ettermiddag'
					: 'kveld';
	return `${day} ${part}`;
}

export type Scores = ReadonlyMap<number, number>;

/**
 * The order the balls stand in the document: answers first, best first, then everything else by
 * date.
 *
 * This is the order a keyboard tabs through and a screen reader reads, so it must follow the
 * ranking and not the physics — a ball's height on screen is decoration, its place in the DOM is
 * the result. Ties keep date order, so two equally good answers read soonest first.
 */
export function pileOrder<E extends { id: number }>(events: readonly E[], scores: Scores): E[] {
	if (scores.size === 0) return [...events];
	const position = new Map(events.map((e, i) => [e.id, i]));
	const answers = events.filter((e) => (scores.get(e.id) ?? 0) >= FLOAT);
	const rest = events.filter((e) => (scores.get(e.id) ?? 0) < FLOAT);
	answers.sort(
		(a, b) =>
			(scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) ||
			(position.get(a.id) ?? 0) - (position.get(b.id) ?? 0)
	);
	return [...answers, ...rest];
}

/** Who answered: Jev, or plain text matching because Jev could not. */
export type PileMode = 'jev' | 'tekst';

/**
 * What happened under the hood, for the page to show.
 *
 * The page says how an answer was made — by which model, over how many events, in how long, from
 * the cache or not — because a pile that floats things with no visible reason asks to be trusted,
 * and this is cheaper than trust. Nothing here is about the visitor, and none of it is stored.
 */
export type PileTrace = {
	/** How many events were held against the question. */
	considered: number;
	/** The model that answered, or null for text matching. */
	model: string | null;
	/** Time inside the model, all requests in parallel. Zero for text. */
	modelMs: number;
	/** Time on our server, from the question arriving to the answer leaving. */
	serverMs: number;
	requests: number;
	inputTokens: number;
	/** Answered from an earlier identical question. `modelMs` is then that question's time. */
	cached: boolean;
	/** Why it was text, when it was. */
	fallback: 'utan-modell' | 'budsjett' | null;
};
