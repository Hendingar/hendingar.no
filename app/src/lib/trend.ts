/**
 * Which way an event is moving on /poppis/vist: a sparkline, today's opens, and its move in the
 * ranking since yesterday.
 *
 * Pure, so the rules are tested rather than eyeballed. Built only from `event_view_days`, which is
 * a count per event per Oslo day — never a row per reader (see the schema).
 */

/** How many days a sparkline spans, today included. */
export const TREND_DAYS = 14;

export type DayCount = { day: string; views: number };

/** Up (positive) or down (negative) this many places since yesterday, or new to the ranking. */
export type RankMove = number | 'ny';

export type Trend = {
	/** Opens per day, oldest first, ending today. Days nobody opened it are zero. */
	series: number[];
	today: number;
	/** Null when the event has never been opened: it has no place to move from. */
	move: RankMove | null;
};

/** The `span` calendar days ending with `today` (YYYY-MM-DD), oldest first. */
export function dayKeys(today: string, span = TREND_DAYS): string[] {
	const end = Date.parse(`${today}T00:00:00Z`);
	return Array.from({ length: span }, (_, i) =>
		new Date(end - (span - 1 - i) * 86_400_000).toISOString().slice(0, 10)
	);
}

export function series(days: readonly DayCount[], today: string, span = TREND_DAYS): number[] {
	const byDay = new Map(days.map((d) => [d.day, d.views]));
	return dayKeys(today, span).map((day) => byDay.get(day) ?? 0);
}

export type Ranked = { id: number; total: number; today: number; startsAt: Date };

/**
 * Each event's move since the end of yesterday, among the events on the page.
 *
 * `rows` is the page's own order — most opened, then soonest — and yesterday is the same rule
 * applied to the totals without today's opens. So a move is exactly "where this card was on this
 * page last night", which is the claim the card makes.
 */
export function rankMoves(rows: readonly Ranked[]): Map<number, RankMove | null> {
	const yesterday = [...rows].sort(
		(a, b) =>
			b.total - b.today - (a.total - a.today) ||
			a.startsAt.getTime() - b.startsAt.getTime() ||
			a.id - b.id
	);
	const placeYesterday = new Map(yesterday.map((r, i) => [r.id, i]));
	const moves = new Map<number, RankMove | null>();
	rows.forEach((row, now) => {
		if (row.total === 0) moves.set(row.id, null);
		else if (row.total - row.today === 0) moves.set(row.id, 'ny');
		else moves.set(row.id, placeYesterday.get(row.id)! - now);
	});
	return moves;
}

/**
 * Every card's trend. `days` is every day-row for these events; rows for other days are ignored,
 * and an event with no rows gets a flat line.
 */
export function trends(
	rows: readonly Ranked[],
	days: readonly (DayCount & { eventId: number })[],
	today: string
): Record<number, Trend> {
	const moves = rankMoves(rows);
	const out: Record<number, Trend> = {};
	for (const row of rows) {
		const own = days.filter((d) => d.eventId === row.id);
		out[row.id] = { series: series(own, today), today: row.today, move: moves.get(row.id) ?? null };
	}
	return out;
}
