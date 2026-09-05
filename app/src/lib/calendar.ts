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
