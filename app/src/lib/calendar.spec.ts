import { describe, expect, it } from 'vitest';
import {
	countByDay,
	instantWindowForDays,
	isMonthKey,
	localDayKey,
	monthBounds,
	monthGrid,
	monthKeyOf,
	shiftMonth
} from './calendar.ts';

/**
 * Every case here is a fixed instant and a fixed zone. Nothing reads the clock: a calendar test
 * that asserts against "today" passes on the day it is written and rots quietly afterwards.
 */

describe('localDayKey', () => {
	/**
	 * The bug this whole module exists to prevent.
	 *
	 * A concert starting at 00:30 on Saturday 12 September in Oslo is stored as 22:30Z on Friday
	 * the 11th, because a timestamptz is an instant and nothing else. Bucketing in UTC — or in
	 * whatever zone the container happens to run in — files it under Friday, so the Saturday square
	 * says 0 while the Saturday page shows it, or the other way round.
	 */
	it('puts an after-midnight event on the day the venue calls it', () => {
		const instant = new Date('2026-09-11T22:30:00Z');
		expect(localDayKey(instant, 'Europe/Oslo')).toBe('2026-09-12');
		// Stated explicitly so the test fails loudly rather than tautologically if the rule is
		// ever "simplified" to toISOString().slice(0, 10).
		expect(instant.toISOString().slice(0, 10)).toBe('2026-09-11');
	});

	/** The mirror case: late evening UTC-side is still the same day in Oslo. */
	it('keeps a late-evening event on its own day', () => {
		expect(localDayKey(new Date('2026-09-12T21:00:00Z'), 'Europe/Oslo')).toBe('2026-09-12');
	});

	it('answers differently for the same instant in different zones', () => {
		const instant = new Date('2026-09-11T22:30:00Z');
		expect(localDayKey(instant, 'Europe/Oslo')).toBe('2026-09-12');
		expect(localDayKey(instant, 'Atlantic/Reykjavik')).toBe('2026-09-11');
	});

	/** Winter time is +01:00, so the same wall clock is a different instant. */
	it('follows the zone across a daylight-saving change', () => {
		expect(localDayKey(new Date('2026-01-11T23:30:00Z'), 'Europe/Oslo')).toBe('2026-01-12');
		expect(localDayKey(new Date('2026-01-11T22:30:00Z'), 'Europe/Oslo')).toBe('2026-01-11');
	});

	it('falls back to the pilot zone for a venue with none', () => {
		expect(localDayKey(new Date('2026-09-11T22:30:00Z'), null)).toBe('2026-09-12');
	});
});

describe('countByDay', () => {
	it('counts each event under its own venue zone, not one shared zone', () => {
		const counts = countByDay([
			{ startsAt: new Date('2026-09-11T22:30:00Z'), venueTimeZone: 'Europe/Oslo' },
			{ startsAt: new Date('2026-09-11T22:30:00Z'), venueTimeZone: 'Atlantic/Reykjavik' },
			{ startsAt: new Date('2026-09-12T10:00:00Z'), venueTimeZone: 'Europe/Oslo' }
		]);
		expect(counts.get('2026-09-12')).toBe(2);
		expect(counts.get('2026-09-11')).toBe(1);
	});

	it('has no entry for a day with nothing on it', () => {
		const counts = countByDay([
			{ startsAt: new Date('2026-09-12T10:00:00Z'), venueTimeZone: 'Europe/Oslo' }
		]);
		expect(counts.has('2026-09-13')).toBe(false);
	});
});

describe('instantWindowForDays', () => {
	/**
	 * The window is only a pre-filter for the index; `localDayKey` decides membership. It is still
	 * the one place an event can be lost outright, so it has to be wider than any real offset.
	 */
	it('contains an event that belongs to the first day of the month', () => {
		const { from, to } = instantWindowForDays('2026-09-01', '2026-09-30');
		// 01:00 on 1 September in Oslo — 23:00Z on 31 August.
		const edge = new Date('2026-08-31T23:00:00Z');
		expect(localDayKey(edge, 'Europe/Oslo')).toBe('2026-09-01');
		expect(edge >= from && edge <= to).toBe(true);
	});

	it('contains an event that belongs to the last day of the month', () => {
		const { from, to } = instantWindowForDays('2026-09-01', '2026-09-30');
		// 23:30 on 30 September in a zone well east of us is still 30 September there.
		const edge = new Date('2026-09-30T12:30:00Z');
		expect(edge >= from && edge <= to).toBe(true);
	});

	it('is a day wider than the days it covers, in both directions', () => {
		const { from, to } = instantWindowForDays('2026-09-12', '2026-09-12');
		expect(from.toISOString()).toBe('2026-09-11T00:00:00.000Z');
		expect(to.toISOString()).toBe('2026-09-14T00:00:00.000Z');
	});
});

describe('monthBounds', () => {
	it('ends a 31-day month on the 31st', () => {
		expect(monthBounds('2026-01')).toEqual({ first: '2026-01-01', last: '2026-01-31' });
	});

	it('gets February right in a leap year and in a common one', () => {
		expect(monthBounds('2024-02').last).toBe('2024-02-29');
		expect(monthBounds('2026-02').last).toBe('2026-02-28');
	});
});

describe('monthGrid', () => {
	/** 1 September 2026 is a tysdag, so the first row has one empty square. */
	it('pads the first week so the month starts in its own column', () => {
		const weeks = monthGrid('2026-09');
		expect(weeks[0]?.[0]).toBeNull();
		expect(weeks[0]?.[1]).toEqual({ date: '2026-09-01', day: 1 });
	});

	it('holds every day of the month exactly once, in whole weeks', () => {
		const weeks = monthGrid('2026-09');
		const days = weeks.flat().filter((c) => c !== null);
		expect(days).toHaveLength(30);
		expect(new Set(days.map((c) => c.date)).size).toBe(30);
		for (const week of weeks) expect(week).toHaveLength(7);
	});

	/**
	 * The row count is not fixed at six. March 2026 starts on a sundag and runs 31 days, which needs
	 * six rows; February 2026 also starts on a sundag but fits in five. A grid hardcoded to six
	 * would draw a whole empty week under February.
	 */
	it('uses as many rows as the month needs, and no more', () => {
		expect(monthGrid('2026-03')).toHaveLength(6);
		expect(monthGrid('2026-08')).toHaveLength(6);
		expect(monthGrid('2026-02')).toHaveLength(5);
		expect(monthGrid('2026-09')).toHaveLength(5);
	});
});

describe('shiftMonth', () => {
	it('rolls over the year in both directions', () => {
		expect(shiftMonth('2026-12', 1)).toBe('2027-01');
		expect(shiftMonth('2026-01', -1)).toBe('2025-12');
		expect(shiftMonth('2026-09', 0)).toBe('2026-09');
	});
});

describe('month keys', () => {
	it('accepts a real month and rejects anything else', () => {
		expect(isMonthKey('2026-09')).toBe(true);
		expect(isMonthKey('2026-13')).toBe(false);
		expect(isMonthKey('2026-9')).toBe(false);
		expect(isMonthKey('2026-09-12')).toBe(false);
	});

	it('reads the month off a calendar date', () => {
		expect(monthKeyOf('2026-09-12')).toBe('2026-09');
	});
});
