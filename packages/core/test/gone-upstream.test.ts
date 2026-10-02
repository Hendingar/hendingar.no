import { describe, expect, it } from 'vitest';
import { planGoneUpstream, type GoneCandidate } from '../src/gone-upstream.ts';

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
