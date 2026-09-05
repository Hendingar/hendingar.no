import { DEFAULT_TIME_ZONE, instantToZonedWallClock } from '@hendingar/core/datetime';
import { calendarMonthSchema } from '@hendingar/core/validation';

/**
 * The calendar's arithmetic, kept pure and away from the database.
 *
 * Everything here is a function of strings and instants — no clock, no I/O — so the one rule that
 * actually decides what the calendar says can be tested rather than eyeballed against a live
 * listing. That rule is `localDayKey`: which calendar day an instant belongs to.
 *
 * It is not a detail. `starts_at` is a `timestamptz`, which records an instant and nothing else. A
 * concert at 00:30 on Saturday in Oslo is stored as 22:30Z on Friday, so anything that derives a
 * day from an instant in UTC — or in whatever zone the container happens to run in — puts it on
 * the wrong date, in both the count and the page the count links to.
 */

/**
 * Is this the `YYYY-MM` the URL and the queries agree on?
 *
 * Delegates to the schema in `packages/core` rather than carrying a second regex: the month is a
 * wire type, and the route that reads `?maanad=` must accept exactly what the query does.
 */
export function isMonthKey(raw: string): boolean {
	return calendarMonthSchema.safeParse(raw).success;
}

/**
 * Which calendar day an instant falls on, at the venue.
 *
 * The single decision the whole feature rests on, and the reason it takes a zone rather than
 * assuming one. `instantToZonedWallClock` is already the tested way to get a wall clock out of an
 * instant (`packages/core/test/datetime.test.ts`), so this adds no second implementation of the
 * hard part — it names the question.
 *
 * The fallback is the pilot's zone, matching every other query in the app: venues predating the
 * timezone column have none, and dropping those events would be worse than assuming Norway.
 */
export function localDayKey(instant: Date, timeZone: string | null | undefined): string {
	return instantToZonedWallClock(instant, timeZone || DEFAULT_TIME_ZONE).date;
}

/** The month a calendar date belongs to. */
export function monthKeyOf(localDate: string): string {
	return localDate.slice(0, 7);
}

/** The first and last calendar date of a month, inclusive. */
export function monthBounds(monthKey: string): { first: string; last: string } {
	const [y, m] = monthKey.split('-').map(Number);
	const year = y ?? 1970;
	const month = m ?? 1;
	// Day 0 of the next month is the last day of this one, which is also how February gets its
	// leap year right without a table.
	const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
	return { first: `${monthKey}-01`, last: `${monthKey}-${String(lastDay).padStart(2, '0')}` };
}

/** Step a month key by whole months. Rolls the year over in both directions. */
export function shiftMonth(monthKey: string, delta: number): string {
	const [y, m] = monthKey.split('-').map(Number);
	const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + delta, 1, 12));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** `null` is a padding cell — a square in the grid that belongs to a neighbouring month. */
export type CalendarCell = { date: string; day: number } | null;

/**
 * A month laid out as weeks of seven, Monday first.
 *
 * Days either side of the month are left as `null` rather than filled with the neighbours' dates.
 * A grid that shows 31 August in the September table invites a tap that silently changes month,
 * and the counts in those squares would belong to a month this page is not describing.
 */
export function monthGrid(monthKey: string): CalendarCell[][] {
	const { first, last } = monthBounds(monthKey);
	const lastDay = Number(last.slice(8));
	const leading = weekdayColumn(first);

	const cells: CalendarCell[] = Array.from({ length: leading }, () => null);
	for (let day = 1; day <= lastDay; day++) {
		cells.push({ date: `${monthKey}-${String(day).padStart(2, '0')}`, day });
	}
	while (cells.length % 7 !== 0) cells.push(null);

	const weeks: CalendarCell[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	return weeks;
}

function weekdayColumn(localDate: string): number {
	const [y, m, d] = localDate.split('-').map(Number);
	// Noon UTC so no offset arithmetic can slide the date onto the day before.
	return (new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)).getUTCDay() + 6) % 7;
}

/**
 * An instant range that is guaranteed to contain every event falling on these calendar days, in
 * any timezone on earth.
 *
 * The day an event belongs to is decided per venue, in that venue's zone, which SQL cannot filter
 * on without giving up the index on `starts_at`. So the query narrows to this window — a plain
 * `between` the planner can use — and `localDayKey` then decides membership exactly.
 *
 * A full day of slack either side, comfortably more than the ±14 hours the widest real offsets
 * reach. Over-fetching a handful of rows costs nothing; under-fetching silently loses an event
 * from the first or last day of the month.
 */
export function instantWindowForDays(
	firstDate: string,
	lastDate: string
): { from: Date; to: Date } {
	const [fy, fm, fd] = firstDate.split('-').map(Number);
	const [ly, lm, ld] = lastDate.split('-').map(Number);
	const from = new Date(Date.UTC(fy ?? 1970, (fm ?? 1) - 1, (fd ?? 1) - 1));
	const to = new Date(Date.UTC(ly ?? 1970, (lm ?? 1) - 1, (ld ?? 1) + 2));
	return { from, to };
}

/**
 * Bucket events into calendar days at their own venue.
 *
 * Deliberately done here rather than as a `to_char(... at time zone ...)` in SQL, which is how the
 * listing derives its day headings. The reason is that the count on a square and the events on the
 * page behind it must be the same set, always — and the only way to guarantee that is for one
 * function to decide both. Two `to_char` expressions in two queries are one careless edit away
 * from disagreeing, and the symptom would be a badge saying 3 above a page showing 2.
 *
 * The cost is reading two columns for a month of rows instead of letting Postgres aggregate. At a
 * few hundred events a month that is not a trade worth thinking about.
 */
export function countByDay(
	rows: readonly { startsAt: Date; venueTimeZone: string | null }[]
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const row of rows) {
		const key = localDayKey(row.startsAt, row.venueTimeZone);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

/*
 * ---------------------------------------------------------------------------------------------
 * Reading a month at a glance
 *
 * A grid of numbers answers "how many on the 12th" only once you have found the 12th and read it.
 * The shape of a month — which weekends are full, where the quiet fortnight is — is the question
 * you actually arrive with, and a number cannot answer it without being read one square at a time.
 *
 * So a square carries its count three ways: the numeral, a fill whose strength tracks it, and a
 * row of pips. Redundant on purpose. Colour alone would fail WCAG 1.4.1 and anyone reading the
 * page in grayscale; the fill alone cannot be told apart at adjacent steps; the numeral alone is
 * what we already had.
 * ---------------------------------------------------------------------------------------------
 */

/**
 * Which fill step a count earns, 0–4.
 *
 * Absolute thresholds rather than a scale relative to the month, so a square means the same thing
 * in a busy July as in a dead February. A relative scale would paint the busiest day of an empty
 * month as darkly as a genuinely full Saturday, which is precisely the lie the fill exists to
 * avoid telling.
 */
export function densityStep(total: number): 0 | 1 | 2 | 3 | 4 {
	if (total <= 0) return 0;
	if (total <= 2) return 1;
	if (total <= 5) return 2;
	if (total <= 9) return 3;
	return 4;
}

/**
 * How many pips a square shows. Capped, because the pip row is a shape to recognise rather than a
 * thing to count — past six they stop being distinguishable at 40px wide and the numeral is
 * already there for anyone who wants the exact figure.
 */
export const MAX_PIPS = 6;

export function pipCount(total: number): number {
	return Math.min(Math.max(total, 0), MAX_PIPS);
}

/**
 * The count at which a day is worth marking as a hotspot in this month.
 *
 * Relative to the month's own peak — the busiest days in a quiet February are worth finding too —
 * but with a floor, because "the busiest day" of a month whose maximum is two events is not a
 * hotspot and saying so would drain the word. Returns `Infinity` for a month that never reaches
 * the floor, so no square is marked rather than the least-quiet one being promoted.
 */
export const HOTSPOT_FLOOR = 5;

export function hotspotFloor(totals: readonly number[]): number {
	const peak = totals.reduce((n, t) => Math.max(n, t), 0);
	if (peak < HOTSPOT_FLOOR) return Infinity;
	return Math.max(HOTSPOT_FLOOR, Math.ceil(peak * 0.8));
}

/**
 * The busiest days of a month, most first, ties broken by date so the order is stable.
 *
 * Derived from the counts the grid already has rather than asked of the database again: the answer
 * is a sort of data that is on the page by the time anyone can read it, and a second query over
 * the same window to re-derive it would be a round trip spent on arithmetic.
 */
export function busiestDays(
	counts: readonly { date: string; total: number }[],
	take = 3
): { date: string; total: number }[] {
	return counts
		.filter((c) => c.total > 0)
		.slice()
		.sort((a, b) => b.total - a.total || a.date.localeCompare(b.date))
		.slice(0, take);
}

/*
 * ---------------------------------------------------------------------------------------------
 * The week's time grid
 *
 * Seven columns against one shared time axis. Everything below works in **minutes past midnight
 * at the venue**, never in instants: two events at "19:00" belong on the same line of the grid
 * even when one is in Oslo and the other in Helsinki and they are an hour apart as instants.
 * That is the whole point of drawing a week — it is a wall clock, not a timeline.
 * ---------------------------------------------------------------------------------------------
 */

/** 09:00–23:00. Community events cluster in the evening; seventeen empty morning hours are not
 *  symmetry, they are a grid nobody can read. The span widens for anything outside it. */
export const DEFAULT_SPAN_START = 9 * 60;
export const DEFAULT_SPAN_END = 23 * 60;

/** A shortest drawable block. A zero-length event still has to be clickable. */
export const MIN_BLOCK_MINUTES = 30;

/** Minutes past midnight, at the venue's own clock. */
export function minutesOfDay(instant: Date, timeZone: string | null | undefined): number {
	const { time } = instantToZonedWallClock(instant, timeZone || DEFAULT_TIME_ZONE);
	const [h, m] = time.split(':').map(Number);
	return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Where an event sits on the day it starts, in minutes.
 *
 * An event that runs past midnight is cut off at the end of its own day rather than drawn into
 * the next column — the block belongs to the day it starts, which is the same rule the counts use.
 * Anything ending before it starts (a bad `ends_at`, or exactly that midnight case) falls back to
 * the minimum length instead of drawing a negative box.
 */
export function blockMinutes(event: {
	startsAt: Date;
	endsAt: Date | null;
	venueTimeZone: string | null;
}): { start: number; end: number } {
	const start = minutesOfDay(event.startsAt, event.venueTimeZone);
	const sameDay =
		event.endsAt !== null &&
		localDayKey(event.endsAt, event.venueTimeZone) ===
			localDayKey(event.startsAt, event.venueTimeZone);
	const rawEnd = sameDay && event.endsAt ? minutesOfDay(event.endsAt, event.venueTimeZone) : start;
	return { start, end: Math.max(rawEnd, start + MIN_BLOCK_MINUTES) };
}

/**
 * The time span the whole week is drawn against.
 *
 * One span for all seven days, never one per day: columns whose hour lines do not line up are not
 * a week, they are seven unrelated charts side by side. Widened to whole hours so the gutter can
 * label every line.
 */
export function weekSpan(blocks: readonly { start: number; end: number }[]): {
	start: number;
	end: number;
} {
	let start = DEFAULT_SPAN_START;
	let end = DEFAULT_SPAN_END;
	for (const block of blocks) {
		start = Math.min(start, Math.floor(block.start / 60) * 60);
		end = Math.max(end, Math.ceil(block.end / 60) * 60);
	}
	return { start, end: Math.min(end, 24 * 60) };
}

export type Placed<T> = T & { start: number; end: number; column: number; columns: number };

/**
 * Lay a single day's blocks out side by side where they overlap.
 *
 * Two events at 19:00 must both be visible; stacking them hides one, and drawing them full-width
 * on top of each other hides one and lies about it. So overlapping blocks split the column between
 * them — what a calendar has always done.
 *
 * A cluster is a run of blocks connected by overlap, and its width is the most columns any moment
 * inside it needs — not the number of blocks in it. A over B and B over C, with A and C not
 * touching, costs two columns: C takes A's column back once A has finished. Counting the blocks
 * instead would spend a third of every such day on empty space.
 *
 * The invariant that matters, and the one the tests assert, is narrower than either: two blocks
 * that overlap in time never share a column.
 */
export function layOutDay<T extends { start: number; end: number }>(
	blocks: readonly T[]
): Placed<T>[] {
	// Longest first among equal starts, so a block that spans the cluster takes the left column and
	// the short ones fill in beside it rather than pushing it right.
	const sorted = blocks.slice().sort((a, b) => a.start - b.start || b.end - a.end);

	const placed: Placed<T>[] = [];
	let cluster: Placed<T>[] = [];
	let clusterEnd = -Infinity;
	// The end of the last block in each column, so a block can reuse a column that has finished.
	let columnEnds: number[] = [];

	const flush = () => {
		const width = columnEnds.length;
		for (const block of cluster) block.columns = width;
		cluster = [];
		columnEnds = [];
		clusterEnd = -Infinity;
	};

	for (const block of sorted) {
		if (block.start >= clusterEnd) flush();

		let column = columnEnds.findIndex((end) => end <= block.start);
		if (column === -1) {
			column = columnEnds.length;
			columnEnds.push(block.end);
		} else {
			columnEnds[column] = block.end;
		}

		const entry: Placed<T> = { ...block, column, columns: 1 };
		cluster.push(entry);
		placed.push(entry);
		clusterEnd = Math.max(clusterEnd, block.end);
	}
	flush();

	return placed;
}
