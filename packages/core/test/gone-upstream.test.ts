import { describe, expect, it } from 'vitest';
import {
	planGoneUpstream,
	planRunSweep,
	type GoneCandidate,
	type TimedCandidate
} from '../src/gone-upstream.ts';

/**
 * The rule that decides whether an event has gone from its source.
 *
 * Pure, and tested as such: the query around it picks which rows to consider, but this is where a
 * mistake would be expensive — marking a live event gone takes it out of every listing, and
 * failing to mark a cancelled one leaves us telling somebody to turn up.
 */
const row = (id: number, externalId: string | null, gone: Date | null = null): GoneCandidate => ({
	id,
	externalId,
	removedUpstreamAt: gone
});

const WHEN = new Date('2026-10-02T06:00:00Z');

describe('planGoneUpstream', () => {
	it('marks the rows this run did not see', () => {
		const plan = planGoneUpstream([row(1, 'a'), row(2, 'b'), row(3, 'c')], new Set(['a', 'c']));
		expect(plan.mark).toEqual([2]);
		expect(plan.restore).toEqual([]);
	});

	it('leaves a row that is already marked alone', () => {
		// The mark records when we FIRST noticed. Rewriting it every day would turn "gone since
		// Tuesday" into "gone since today", which is the one thing the timestamp is for.
		const plan = planGoneUpstream([row(1, 'a', WHEN)], new Set(['b']));
		expect(plan.mark).toEqual([]);
	});

	it('clears the mark when the source lists it again', () => {
		/*
		 * Self-healing, deliberately. A source that drops an event for one run and brings it back —
		 * a cache miss, a half-written page, an editor saving twice — must not leave us permanently
		 * hiding a real event.
		 */
		const plan = planGoneUpstream([row(1, 'a', WHEN), row(2, 'b', WHEN)], new Set(['a']));
		expect(plan.restore).toEqual([1]);
		expect(plan.mark).toEqual([]);
	});

	it('does nothing at all when the run saw nothing', () => {
		/*
		 * The guard that matters most. An upstream answering 200 with an empty collection looks
		 * exactly like one that cancelled everything, and only the first ever actually happens.
		 * Without this, a single bad response would empty a source from the site.
		 */
		const plan = planGoneUpstream([row(1, 'a'), row(2, 'b'), row(3, 'c')], new Set());
		expect(plan).toEqual({ mark: [], restore: [] });
	});

	it('marks a row with no external id, because nothing can ever match it', () => {
		// Only an imported row reaches this sweep, and an import with no external_id cannot be
		// matched against any future run — so it is gone by definition rather than by accident.
		const plan = planGoneUpstream([row(1, null)], new Set(['a']));
		expect(plan.mark).toEqual([1]);
	});

	it('is decided per row, so one run can mark and restore at once', () => {
		const plan = planGoneUpstream(
			[row(1, 'a'), row(2, 'b', WHEN), row(3, 'c'), row(4, 'd', WHEN)],
			new Set(['b', 'c'])
		);
		expect(plan.mark).toEqual([1]);
		expect(plan.restore).toEqual([2]);
	});
});

describe('planRunSweep', () => {
	const NOW = new Date('2026-11-18T06:00:00Z');
	const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
	const at = (id: number, externalId: string, days: number, gone: Date | null = null) =>
		({ id, externalId, removedUpstreamAt: gone, startsAt: day(days) }) satisfies TimedCandidate;
	const base = {
		mode: 'window' as const,
		seen: new Set(['a', 'b']),
		latestStart: day(10),
		unidentified: 0,
		now: NOW
	};

	it('judges only what the page covered: from now to the latest start it saw', () => {
		const { plan } = planRunSweep({
			...base,
			candidates: [at(1, 'a', 1), at(2, 'b', 10), at(3, 'gone', 5), at(4, 'beyond', 30)]
		});
		// 3 fell inside the window and was not there; 4 is past the last thing the page showed.
		expect(plan).toEqual({ mark: [3], restore: [] });
	});

	it('leaves alone an event that started before now, which a from-today listing omits', () => {
		const { plan } = planRunSweep({ ...base, candidates: [at(1, 'a', 1), at(5, 'running', -2)] });
		expect(plan?.mark).toEqual([]);
	});

	it('judges every future row when the listing is complete', () => {
		const { plan } = planRunSweep({
			...base,
			mode: 'complete',
			candidates: [at(1, 'a', 1), at(4, 'beyond', 30)]
		});
		expect(plan?.mark).toEqual([4]);
	});

	it('puts back an event that is listed again', () => {
		const { plan } = planRunSweep({ ...base, candidates: [at(1, 'a', 1, day(-1))] });
		expect(plan).toEqual({ mark: [], restore: [1] });
	});

	it('does nothing for an importer that sweeps itself or cannot vouch for absence', () => {
		for (const mode of ['self', 'off'] as const) {
			expect(planRunSweep({ ...base, mode, candidates: [at(3, 'gone', 5)] })).toEqual({
				plan: null,
				skipped: null
			});
		}
	});

	it('does nothing when a rejected row had no id, and says why', () => {
		const result = planRunSweep({ ...base, unidentified: 2, candidates: [at(3, 'gone', 5)] });
		expect(result.plan).toBeNull();
		expect(result.skipped).toMatch(/2 row\(s\) rejected without an id/);
	});

	it('does nothing when the run saw nothing', () => {
		const result = planRunSweep({
			...base,
			seen: new Set(),
			latestStart: null,
			candidates: [at(3, 'gone', 5)]
		});
		expect(result).toEqual({ plan: null, skipped: null });
	});

	it('refuses a sweep that would take more than the run saw: that is a broken read', () => {
		const candidates = [at(1, 'a', 1), at(2, 'b', 2)];
		for (let i = 0; i < 6; i++) candidates.push(at(10 + i, `lost-${i}`, 3));
		const result = planRunSweep({ ...base, candidates });
		expect(result.plan).toBeNull();
		expect(result.skipped).toMatch(/broken read/);
	});

	it('still sweeps a handful even when the run saw fewer', () => {
		const result = planRunSweep({
			...base,
			seen: new Set(['a']),
			latestStart: day(10),
			candidates: [at(1, 'a', 1), at(2, 'x', 2), at(3, 'y', 3)]
		});
		expect(result.plan?.mark).toEqual([2, 3]);
	});
});
