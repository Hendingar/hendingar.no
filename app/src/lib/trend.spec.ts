import { describe, expect, it } from 'vitest';
import { dayKeys, rankMoves, series, trends, type Ranked } from './trend.ts';

const at = (iso: string) => new Date(iso);

describe('dayKeys', () => {
	it('ends with today and runs oldest first', () => {
		expect(dayKeys('2026-10-21', 3)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
	});

	it('crosses a month and the clock change without skipping or repeating a day', () => {
		// Norway leaves summer time on 2026-10-25; calendar days must not care.
		expect(dayKeys('2026-11-01', 9)).toEqual([
			'2026-10-24',
			'2026-10-25',
			'2026-10-26',
			'2026-10-27',
			'2026-10-28',
			'2026-10-29',
			'2026-10-30',
			'2026-10-31',
			'2026-11-01'
		]);
	});
});

describe('series', () => {
	it('fills days nobody opened it with zero, and ignores days outside the span', () => {
		const days = [
			{ day: '2026-10-01', views: 50 },
			{ day: '2026-10-19', views: 3 },
			{ day: '2026-10-21', views: 1 }
		];
		expect(series(days, '2026-10-21', 3)).toEqual([3, 0, 1]);
	});
});

describe('rankMoves', () => {
	const row = (
		id: number,
		total: number,
		today: number,
		starts = '2026-11-01T18:00:00Z'
	): Ranked => ({
		id,
		total,
		today,
		startsAt: at(starts)
	});

	it('says how many places a card climbed since last night', () => {
		// Last night: 1 (10), 2 (8), 3 (5). Today 3 got six opens and now leads.
		const rows = [row(3, 11, 6), row(1, 10, 0), row(2, 8, 0)];
		const moves = rankMoves(rows);
		expect(moves.get(3)).toBe(2);
		expect(moves.get(1)).toBe(-1);
		expect(moves.get(2)).toBe(-1);
	});

	it('marks an event first opened today as new, not as a climb from nowhere', () => {
		const moves = rankMoves([row(1, 5, 0), row(2, 2, 2)]);
		expect(moves.get(2)).toBe('ny');
		expect(moves.get(1)).toBe(0);
	});

	it('gives an event nobody has opened no move at all', () => {
		expect(rankMoves([row(1, 0, 0)]).get(1)).toBeNull();
	});

	it("breaks yesterday's ties the way the page does: soonest first", () => {
		// Tied at 4 last night; the later one got an open today and passed the sooner one.
		const rows = [row(2, 5, 1, '2026-11-02T18:00:00Z'), row(1, 4, 0, '2026-11-01T18:00:00Z')];
		const moves = rankMoves(rows);
		expect(moves.get(2)).toBe(1);
		expect(moves.get(1)).toBe(-1);
	});
});

describe('trends', () => {
	it("gives every card a line, today's opens and a move", () => {
		const rows: Ranked[] = [{ id: 7, total: 3, today: 1, startsAt: at('2026-11-01T18:00:00Z') }];
		const days = [
			{ eventId: 7, day: '2026-10-20', views: 2 },
			{ eventId: 7, day: '2026-10-21', views: 1 },
			{ eventId: 8, day: '2026-10-21', views: 9 }
		];
		const t = trends(rows, days, '2026-10-21')[7]!;
		expect(t.series.slice(-2)).toEqual([2, 1]);
		expect(t.series).toHaveLength(14);
		expect(t.today).toBe(1);
		expect(t.move).toBe(0);
	});
});
