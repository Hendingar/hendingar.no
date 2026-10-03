import { describe, expect, it } from 'vitest';
import type { PileRanking } from '@hendingar/core/validation';
import { AnswerCache, Budget, answer, type PileAnswer, type PileCandidate } from './pile-answer.ts';

const pile = [{ id: 1 }, { id: 2 }, { id: 3 }];

function candidate(e: { id: number }): PileCandidate {
	return {
		id: e.id,
		title: `Hending ${e.id}`,
		categoryLabel: null,
		when: null,
		venueName: null,
		municipality: null,
		organizerName: null,
		description: null
	};
}

/** A ranker that counts its calls and answers 0.8 for everything, or null when told to. */
function ranker(result: 'answer' | 'unavailable' = 'answer') {
	const calls: string[] = [];
	return {
		calls,
		rank: async (q: string, candidates: PileCandidate[]): Promise<PileRanking | null> => {
			calls.push(q);
			if (result === 'unavailable') return null;
			return {
				scores: candidates.map((c) => ({ eventId: c.id, score: 0.8 })),
				model: 'jev-test',
				elapsedMs: 300,
				requests: 1,
				inputTokens: 750
			};
		}
	};
}

const text = async (_q: string, ids: readonly number[]) =>
	ids.map((id) => ({ eventId: id, score: id === 1 ? 1 : 0 }));

function deps(rank: ReturnType<typeof ranker>['rank'], now = { t: 0 }, perMinute = 60) {
	return {
		cache: new AnswerCache(15 * 60_000, 500),
		budget: new Budget(perMinute, 0),
		candidate,
		rank,
		text,
		now: () => now.t
	};
}

describe('answer', () => {
	it('asks the ranker and says so', async () => {
		const r = ranker();
		const result = await answer('konsertar', pile, deps(r.rank));
		expect(result.mode).toBe('jev');
		expect(result.scores).toHaveLength(3);
		expect(result.trace).toMatchObject({
			considered: 3,
			model: 'jev-test',
			modelMs: 300,
			inputTokens: 750,
			cached: false,
			fallback: null
		});
		expect(r.calls).toEqual(['konsertar']);
	});

	it('answers a repeated question from the cache, whatever its case', async () => {
		const r = ranker();
		const d = deps(r.rank);
		await answer('Konsertar', pile, d);
		const again = await answer('konsertar', pile, d);
		expect(again.mode).toBe('jev');
		expect(again.trace.cached).toBe(true);
		expect(r.calls).toHaveLength(1);
	});

	it('asks again once the cached answer has expired', async () => {
		const r = ranker();
		const now = { t: 0 };
		const d = deps(r.rank, now);
		await answer('konsertar', pile, d);
		now.t = 15 * 60_000 + 1;
		await answer('konsertar', pile, d);
		expect(r.calls).toHaveLength(2);
	});

	it('treats a changed pile as a new question', async () => {
		const r = ranker();
		const d = deps(r.rank);
		await answer('konsertar', pile, d);
		await answer('konsertar', [...pile, { id: 4 }], d);
		expect(r.calls).toHaveLength(2);
	});

	it('falls back to text when the ranker is unavailable, and does not cache that', async () => {
		const r = ranker('unavailable');
		const d = deps(r.rank);
		const first = await answer('konsertar', pile, d);
		expect(first.mode).toBe('tekst');
		expect(first.scores).toEqual([
			{ eventId: 1, score: 1 },
			{ eventId: 2, score: 0 },
			{ eventId: 3, score: 0 }
		]);
		expect(first.trace.fallback).toBe('utan-modell');
		await answer('konsertar', pile, d);
		expect(r.calls).toHaveLength(2);
	});

	it('answers by text once the budget is spent, without asking the ranker', async () => {
		const r = ranker();
		const d = deps(r.rank, { t: 0 }, 2);
		await answer('a', pile, d);
		await answer('b', pile, d);
		const third = await answer('c', pile, d);
		expect(third.mode).toBe('tekst');
		expect(third.trace.fallback).toBe('budsjett');
		expect(r.calls).toEqual(['a', 'b']);
	});
});

describe('Budget', () => {
	it('refills continuously, up to its limit', () => {
		const budget = new Budget(60, 0);
		for (let i = 0; i < 60; i++) expect(budget.take(0)).toBe(true);
		expect(budget.take(0)).toBe(false);
		// One token a second at sixty a minute.
		expect(budget.take(1_000)).toBe(true);
		expect(budget.take(1_000)).toBe(false);
	});
});

describe('AnswerCache', () => {
	it('evicts the least recently used entry past its capacity', () => {
		const cache = new AnswerCache(60_000, 2);
		const a: PileAnswer = {
			mode: 'jev',
			scores: [],
			trace: {
				considered: 0,
				model: null,
				modelMs: 0,
				serverMs: 0,
				requests: 0,
				inputTokens: 0,
				cached: false,
				fallback: null
			}
		};
		cache.set('one', a, 0);
		cache.set('two', a, 0);
		cache.get('one', 0);
		cache.set('three', a, 0);
		expect(cache.get('one', 0)).toBeDefined();
		expect(cache.get('two', 0)).toBeUndefined();
		expect(cache.get('three', 0)).toBeDefined();
	});
});
