import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SPAN_END,
	DEFAULT_SPAN_START,
	MAX_PIPS,
	MIN_BLOCK_MINUTES,
	blockMinutes,
	busiestDays,
	countByDay,
	densityStep,
	hotspotFloor,
	instantWindowForDays,
	isMonthKey,
	layOutDay,
	localDayKey,
	minutesOfDay,
	monthBounds,
	monthGrid,
	monthKeyOf,
	pipCount,
	shiftMonth,
	weekSpan
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

describe('densityStep', () => {
	/**
	 * Absolute, not relative to the month. A square must mean the same thing in a busy July as in
	 * a dead February, or the fill is decoration rather than information.
	 */
	it('steps on the documented boundaries', () => {
		expect([0, 1, 2, 3, 5, 6, 9, 10, 40].map(densityStep)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
	});

	it('treats a negative count as empty rather than inverting the scale', () => {
		expect(densityStep(-1)).toBe(0);
	});

	it('never asks for more pips than a square can show', () => {
		expect(pipCount(0)).toBe(0);
		expect(pipCount(4)).toBe(4);
		expect(pipCount(40)).toBe(MAX_PIPS);
	});
});

describe('hotspotFloor', () => {
	it('marks the top of a busy month', () => {
		// Peak 9 → 80% is 7.2, rounded up to 8. The 9 and any 8 are hotspots; a 7 is not.
		expect(hotspotFloor([1, 4, 9, 2, 8, 7])).toBe(8);
	});

	/**
	 * The reason there is a floor at all. Without it the busiest day of an almost-empty month gets
	 * a badge saying "hotspot" for two events, which drains the word everywhere else.
	 */
	it('marks nothing in a month that never gets busy', () => {
		expect(hotspotFloor([1, 2, 1])).toBe(Infinity);
		expect(hotspotFloor([])).toBe(Infinity);
	});

	it('never drops below the floor even when the peak is exactly on it', () => {
		expect(hotspotFloor([5, 1, 1])).toBe(5);
	});
});

describe('busiestDays', () => {
	const counts = [
		{ date: '2026-09-03', total: 4 },
		{ date: '2026-09-11', total: 9 },
		{ date: '2026-09-18', total: 4 },
		{ date: '2026-09-20', total: 0 }
	];

	it('ranks by count and breaks ties by date, so the order never wobbles', () => {
		expect(busiestDays(counts)).toEqual([
			{ date: '2026-09-11', total: 9 },
			{ date: '2026-09-03', total: 4 },
			{ date: '2026-09-18', total: 4 }
		]);
	});

	it('leaves empty days out — a busiest day with nothing on it is not one', () => {
		expect(busiestDays([{ date: '2026-09-20', total: 0 }])).toEqual([]);
	});

	it('does not reorder its input', () => {
		const original = counts.slice();
		busiestDays(counts);
		expect(counts).toEqual(original);
	});
});

describe('minutesOfDay', () => {
	/**
	 * The point of drawing a week. Two events "at 19:00" belong on the same line of the grid even
	 * when they are an hour apart as instants, because a week view is a wall clock.
	 */
	it('reads the venue’s clock, not the server’s and not UTC', () => {
		const instant = new Date('2026-09-12T20:00:00+02:00');
		expect(minutesOfDay(instant, 'Europe/Oslo')).toBe(20 * 60);
		expect(minutesOfDay(instant, 'Europe/Helsinki')).toBe(21 * 60);
		// Stated so this fails loudly rather than tautologically if the zone is ever dropped.
		expect(instant.getUTCHours()).toBe(18);
	});

	it('falls back to the pilot zone for a venue with none', () => {
		expect(minutesOfDay(new Date('2026-09-12T20:30:00+02:00'), null)).toBe(20 * 60 + 30);
	});
});

describe('blockMinutes', () => {
	const oslo = 'Europe/Oslo';

	it('spans start to end when both are on the same day', () => {
		expect(
			blockMinutes({
				startsAt: new Date('2026-09-12T19:00:00+02:00'),
				endsAt: new Date('2026-09-12T21:30:00+02:00'),
				venueTimeZone: oslo
			})
		).toEqual({ start: 19 * 60, end: 21 * 60 + 30 });
	});

	/**
	 * A concert that runs past midnight belongs to the day it starts — the same rule the counts
	 * use. Drawing it into the next column would put it on a day whose square never counted it.
	 */
	it('cuts a past-midnight event off at its own day rather than bleeding into the next', () => {
		const block = blockMinutes({
			startsAt: new Date('2026-09-12T22:30:00+02:00'),
			endsAt: new Date('2026-09-13T01:00:00+02:00'),
			venueTimeZone: oslo
		});
		expect(block.start).toBe(22 * 60 + 30);
		expect(block.end).toBe(22 * 60 + 30 + MIN_BLOCK_MINUTES);
		expect(block.end).toBeLessThanOrEqual(24 * 60);
	});

	it('gives an event with no end a drawable length instead of a zero-height box', () => {
		const block = blockMinutes({
			startsAt: new Date('2026-09-12T19:00:00+02:00'),
			endsAt: null,
			venueTimeZone: oslo
		});
		expect(block.end - block.start).toBe(MIN_BLOCK_MINUTES);
	});
});

describe('weekSpan', () => {
	it('keeps the readable evening window when nothing falls outside it', () => {
		expect(weekSpan([{ start: 19 * 60, end: 21 * 60 }])).toEqual({
			start: DEFAULT_SPAN_START,
			end: DEFAULT_SPAN_END
		});
		expect(weekSpan([])).toEqual({ start: DEFAULT_SPAN_START, end: DEFAULT_SPAN_END });
	});

	it('opens up for an event outside it, rounded to whole hours so the gutter can label them', () => {
		expect(weekSpan([{ start: 6 * 60 + 45, end: 23 * 60 + 10 }])).toEqual({
			start: 6 * 60,
			end: 24 * 60
		});
	});

	it('never runs past the end of the day', () => {
		expect(weekSpan([{ start: 23 * 60, end: 24 * 60 }]).end).toBe(24 * 60);
	});
});

describe('layOutDay', () => {
	it('gives a day with no overlaps the full width', () => {
		const placed = layOutDay([
			{ start: 600, end: 660 },
			{ start: 700, end: 760 }
		]);
		expect(placed.map((p) => p.columns)).toEqual([1, 1]);
		expect(placed.map((p) => p.column)).toEqual([0, 0]);
	});

	it('splits the width between two events at the same time', () => {
		const placed = layOutDay([
			{ start: 1140, end: 1260 },
			{ start: 1140, end: 1200 }
		]);
		expect(placed.every((p) => p.columns === 2)).toBe(true);
		expect(placed.map((p) => p.column).sort()).toEqual([0, 1]);
	});

	/**
	 * The invariant the whole function exists for: nothing is ever hidden underneath anything.
	 *
	 * Asserted over a chain — A overlaps B, B overlaps C, A and C never touch — because that is the
	 * shape a naive implementation gets wrong in both directions. It either gives A and C the same
	 * column while B is still on screen, hiding one, or it counts the blocks and spends a third of
	 * the day on empty space. The chain costs two columns: C takes A's column back once A has finished.
	 */
	it('never puts two overlapping blocks in the same column', () => {
		const placed = layOutDay([
			{ start: 600, end: 720 },
			{ start: 690, end: 810 },
			{ start: 780, end: 900 }
		]);
		for (const a of placed) {
			for (const b of placed) {
				if (a === b) continue;
				if (a.start < b.end && b.start < a.end) expect(a.column).not.toBe(b.column);
			}
		}
		expect(placed.every((p) => p.columns === 2)).toBe(true);
	});

	it('reuses a column once its block has finished', () => {
		const placed = layOutDay([
			{ start: 600, end: 660 },
			{ start: 600, end: 780 },
			{ start: 670, end: 700 }
		]);
		// Three blocks, but only two are ever on screen together.
		expect(placed.every((p) => p.columns === 2)).toBe(true);
	});

	it('does not mutate or reorder its input', () => {
		const input = [
			{ start: 700, end: 760 },
			{ start: 600, end: 660 }
		];
		const copy = structuredClone(input);
		layOutDay(input);
		expect(input).toEqual(copy);
	});
});
