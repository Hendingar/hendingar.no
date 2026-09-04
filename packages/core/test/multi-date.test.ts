import { describe, expect, it } from 'vitest';
import { instantToZonedWallClock, zonedWallClockToInstant } from '../src/datetime.ts';

/**
 * A poster that lists its evenings one by one.
 *
 * "torsdagar: 27.aug. 24.sept. 29.okt. og 26.nov" is four events, not a repetition — nothing about
 * four Thursdays scattered across a term follows a rule `expandRecurrence` could produce. Each date
 * is resolved independently in the venue's zone, which is what this covers.
 */
describe('dates listed one by one', () => {
	const LISTED = ['2026-08-27', '2026-09-24', '2026-10-29', '2026-11-26'];

	it('keeps the same wall clock across the October change', () => {
		/*
		 * The bug a shared offset would cause. 27 August is CEST (+02:00) and 29 October is CET
		 * (+01:00); computing one instant and adding weeks to it would land the autumn evenings an
		 * hour early. Resolving each date in the zone keeps every one of them at 18:00.
		 */
		for (const day of LISTED) {
			const instant = zonedWallClockToInstant(day, '18:00', 'Europe/Oslo');
			expect(instantToZonedWallClock(instant, 'Europe/Oslo')).toEqual({ date: day, time: '18:00' });
		}
	});

	it('produces four distinct instants, an hour apart in offset either side of the change', () => {
		const instants = LISTED.map((d) => zonedWallClockToInstant(d, '18:00', 'Europe/Oslo'));
		expect(new Set(instants.map((i) => i.getTime())).size).toBe(4);
		// Summer time: 18:00 Oslo is 16:00Z. Winter: 17:00Z.
		expect(instants[0]!.toISOString()).toBe('2026-08-27T16:00:00.000Z');
		expect(instants[2]!.toISOString()).toBe('2026-10-29T17:00:00.000Z');
	});

	it('sorts to a usable first date even when the poster leads with a passed one', () => {
		/*
		 * A poster read in November still lists August at the top. Taking the first printed date
		 * put an already-passed event in the box, which is what was happening.
		 */
		const today = '2026-11-01';
		const sorted = [...LISTED].sort();
		const first = sorted.find((d) => d >= today) ?? sorted[0];
		expect(first).toBe('2026-11-26');
	});
});
