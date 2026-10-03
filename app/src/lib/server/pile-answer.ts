import { createHash } from 'node:crypto';
import type { PileRanking, PileScore } from '@hendingar/core/validation';
import type { PileMode, PileTrace } from '../haugen.ts';

/**
 * How `/haugen` decides who answers a question: the cache, the budget, the ranker, or text.
 *
 * Its own module, with no database and no environment, so the rules can be tested as rules. The
 * wiring — the real ranker, the real text match, the wall clock — is in `haugen.ts`.
 */

/** One event as the ranker is told about it. Words, not timestamps: see `haugen.py`. */
export type PileCandidate = {
	id: number;
	title: string;
	categoryLabel: string | null;
	/** "laurdag kveld" — Jev reads a timestamp as text and cannot compare one. */
	when: string | null;
	venueName: string | null;
	municipality: string | null;
	organizerName: string | null;
	description: string | null;
};

export type PileAnswer = { mode: PileMode; scores: PileScore[]; trace: PileTrace };

/**
 * Answers already given, by query and pile.
 *
 * The key includes the pile itself, so an answer never outlives the events it was about: when a
 * concert ends, or an importer adds one, the next question about that pile is a new question. A
 * visitor typing "konsertar" gets the same answer as the last one who did, for free.
 *
 * Fifteen minutes because the pile changes slowly and a search is not personal. 500 entries
 * because a long tail of one-off phrasings should not push out "konsertar".
 */
export class AnswerCache {
	readonly #entries = new Map<string, { answer: PileAnswer; at: number }>();

	constructor(
		readonly ttlMs = 15 * 60_000,
		readonly capacity = 500
	) {}

	get(key: string, now: number): PileAnswer | undefined {
		const hit = this.#entries.get(key);
		if (!hit) return undefined;
		if (now - hit.at > this.ttlMs) {
			this.#entries.delete(key);
			return undefined;
		}
		// Re-insert so a Map's insertion order is recency order, and eviction takes the oldest.
		this.#entries.delete(key);
		this.#entries.set(key, hit);
		return hit.answer;
	}

	set(key: string, answer: PileAnswer, now: number): void {
		this.#entries.delete(key);
		this.#entries.set(key, { answer, at: now });
		while (this.#entries.size > this.capacity) {
			const oldest = this.#entries.keys().next().value;
			if (oldest === undefined) break;
			this.#entries.delete(oldest);
		}
	}
}

/**
 * A spending limit on uncached questions, for the whole site.
 *
 * Sixty a minute, refilled continuously. One question is two requests of ~17k tokens, about a
 * seventh of a cent, so the cap is not about a normal evening; it is about somebody scripting the
 * endpoint with random strings to run up a bill. Past it the pile answers by text until the
 * bucket refills, which is a worse answer and not a broken page.
 */
export class Budget {
	#tokens: number;
	#at: number;

	constructor(
		readonly perMinute = 60,
		now = 0
	) {
		this.#tokens = perMinute;
		this.#at = now;
	}

	take(now: number): boolean {
		const elapsed = Math.max(0, now - this.#at);
		this.#tokens = Math.min(this.perMinute, this.#tokens + (elapsed / 60_000) * this.perMinute);
		this.#at = now;
		if (this.#tokens < 1) return false;
		this.#tokens -= 1;
		return true;
	}
}

export type Ranker = (q: string, candidates: PileCandidate[]) => Promise<PileRanking | null>;
export type TextMatcher = (q: string, ids: readonly number[]) => Promise<PileScore[]>;

/**
 * Answer one question about one pile: from the cache, from the ranker within budget, or by text.
 *
 * Only a ranker's answer is cached. Caching a text fallback would pin "konsertar" to the worse
 * answer for fifteen minutes after one cold start.
 */
export async function answer<E extends { id: number }>(
	q: string,
	pile: readonly E[],
	deps: {
		candidate: (event: E) => PileCandidate;
		cache: AnswerCache;
		budget: Budget;
		rank: Ranker;
		text: TextMatcher;
		now: () => number;
	}
): Promise<PileAnswer> {
	const started = deps.now();
	const ids = pile.map((e) => e.id);
	const key = `${q.toLowerCase()}\u0000${pileHash(ids)}`;
	const cached = deps.cache.get(key, started);
	if (cached) {
		return {
			...cached,
			trace: { ...cached.trace, cached: true, serverMs: deps.now() - started }
		};
	}

	const affordable = deps.budget.take(started);
	if (affordable) {
		const ranking = await deps.rank(q, pile.map(deps.candidate));
		if (ranking) {
			const result: PileAnswer = {
				mode: 'jev',
				scores: ranking.scores,
				trace: {
					considered: ids.length,
					model: ranking.model,
					modelMs: ranking.elapsedMs,
					serverMs: deps.now() - started,
					requests: ranking.requests,
					inputTokens: ranking.inputTokens,
					example: ranking.example,
					cached: false,
					fallback: null
				}
			};
			deps.cache.set(key, result, deps.now());
			return result;
		}
	}
	const scores = await deps.text(q, ids);
	return {
		mode: 'tekst',
		scores,
		trace: {
			considered: ids.length,
			model: null,
			modelMs: 0,
			serverMs: deps.now() - started,
			requests: 0,
			inputTokens: 0,
			example: null,
			cached: false,
			fallback: affordable ? 'utan-modell' : 'budsjett'
		}
	};
}

function pileHash(ids: readonly number[]): string {
	return createHash('sha1').update(ids.join(',')).digest('base64url');
}
