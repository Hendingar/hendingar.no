/**
 * Recurring events — the rule, and the expansion of a rule into dated occurrences.
 *
 * Posters state recurrence, not dates: "torsdager kl 12–17", "quiz kvar tysdag", "første måndag i
 * månaden". Until now such an event could not be represented at all; the importer and the
 * extraction both had to drop it or invent a single date.
 *
 * ## Why occurrences are materialised, not expanded at query time
 *
 * Every listing in the app is `starts_at >= now() ORDER BY starts_at` grouped by day. A rule
 * expanded at query time would mean every one of those queries UNIONs generated rows, losing the
 * index and the day grouping. Materialising concrete `events` rows instead means the front page,
 * the day headings, deduplication, verification and the iCal feed all keep working untouched — a
 * recurring event is simply an event that has siblings.
 *
 * The cost is a rolling horizon to top up (see HORIZON_WEEKS) and N rows per series. Both are
 * cheap; rewriting every query is not.
 *
 * ## Why a constrained rule rather than RFC 5545 RRULE
 *
 * RRULE is the interchange format and `toRRule` emits it for iCal export. But accepting arbitrary
 * RRULE means accepting BYSETPOS, EXDATE, and recurrence patterns we cannot render in Nynorsk, let
 * alone let a submitter verify on a form. The rule below covers what community posters actually
 * say, and every value in it can be described in one phrase and checked by a human.
 */

import { zonedWallClockToInstant, DEFAULT_TIME_ZONE } from './datetime.ts';

/** How far ahead occurrences are materialised. Matches the importer's own forward cap. */
export const HORIZON_WEEKS = 26;

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** 1 = Monday … 7 = Sunday. ISO-8601 numbering, so it does not depend on locale week start. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type Recurrence = {
	freq: RecurrenceFrequency;
	/** Every N periods. 2 with freq `weekly` is "annakvar veke". */
	interval: number;
	/** Which weekdays. Required for `weekly` and `monthly`, ignored for `daily`. */
	weekdays: Weekday[];
	/**
	 * For `monthly`: which occurrence of the weekday in the month. 1–5, or -1 for the last.
	 * "første måndag i månaden" is `{ freq: 'monthly', nth: 1, weekdays: [1] }`.
	 */
	nth: number | null;
	/** Last local date the series runs, inclusive. Null means open-ended (capped by the horizon). */
	until: string | null;
};

export const WEEKDAY_NAMES: Record<Weekday, string> = {
	1: 'måndag',
	2: 'tysdag',
	3: 'onsdag',
	4: 'torsdag',
	5: 'fredag',
	6: 'laurdag',
	7: 'sundag'
};

/* ------------------------------------------------------------------------------------------------
 * Calendar arithmetic on local dates.
 *
 * A local date is a calendar date, not an instant, so it is represented as UTC midnight purely for
 * counting. No timezone enters until the wall clock is resolved in `expandRecurrence`. Doing the
 * arithmetic in local time is where DST bugs come from.
 * ---------------------------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

function parseLocalDate(date: string): number {
	const [year, month, day] = date.split('-').map(Number);
	if (
		year === undefined ||
		month === undefined ||
		day === undefined ||
		Number.isNaN(year) ||
		Number.isNaN(month) ||
		Number.isNaN(day)
	) {
		throw new Error(`invalid local date: ${date}`);
	}
	return Date.UTC(year, month - 1, day);
}

function formatLocalDate(stamp: number): string {
	return new Date(stamp).toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday. `getUTCDay` returns 0 for Sunday, which we map to 7. */
function isoWeekday(stamp: number): Weekday {
	const day = new Date(stamp).getUTCDay();
	return (day === 0 ? 7 : day) as Weekday;
}

/** UTC midnight of the Monday of that date's week. Used for the weekly interval count. */
function weekStart(stamp: number): number {
	return stamp - (isoWeekday(stamp) - 1) * DAY_MS;
}

function monthIndex(stamp: number): number {
	const d = new Date(stamp);
	return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** Which occurrence of its own weekday this date is within its month: 1 for the first, etc. */
function nthOfMonth(stamp: number): number {
	return Math.floor((new Date(stamp).getUTCDate() - 1) / 7) + 1;
}

/** True when this date is the last occurrence of its weekday in its month. */
function isLastOfMonth(stamp: number): boolean {
	return monthIndex(stamp + 7 * DAY_MS) !== monthIndex(stamp);
}

/** Does a single local date satisfy the rule, counting periods from `anchor`? */
export function matchesRecurrence(rule: Recurrence, anchor: string, date: string): boolean {
	const start = parseLocalDate(anchor);
	const stamp = parseLocalDate(date);
	if (stamp < start) return false;
	if (rule.until && stamp > parseLocalDate(rule.until)) return false;

	const interval = Math.max(1, Math.trunc(rule.interval));

	if (rule.freq === 'daily') {
		return Math.round((stamp - start) / DAY_MS) % interval === 0;
	}

	if (!rule.weekdays.includes(isoWeekday(stamp))) return false;

	if (rule.freq === 'weekly') {
		const weeks = Math.round((weekStart(stamp) - weekStart(start)) / (7 * DAY_MS));
		return weeks % interval === 0;
	}

	// monthly
	if ((monthIndex(stamp) - monthIndex(start)) % interval !== 0) return false;
	if (rule.nth === null) return true;
	return rule.nth === -1 ? isLastOfMonth(stamp) : nthOfMonth(stamp) === rule.nth;
}

export type Occurrence = {
	/** The local calendar date of this occurrence. */
	localDate: string;
	startsAt: Date;
	endsAt: Date | null;
};

/**
 * Expand a rule into concrete occurrences inside a window.
 *
 * Pure: no clock, no randomness. `from`/`to` are supplied by the caller, so the same arguments
 * always produce the same rows and a test needs no fake timers.
 *
 * Iterates day by day and tests each date against the rule. 26 weeks is 182 iterations — the
 * clever arithmetic that avoids them is also where recurrence implementations go wrong, and this
 * runs once per series per top-up.
 */
export function expandRecurrence(input: {
	recurrence: Recurrence;
	/** First date the series can occur on, and the anchor the interval counts from. */
	anchorDate: string;
	startTime: string;
	endTime?: string | null;
	timeZone?: string;
	/** Window, inclusive, as local dates. */
	from: string;
	to: string;
	/** Hard cap, so a malformed rule cannot produce an unbounded write. */
	limit?: number;
}): Occurrence[] {
	const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
	const limit = input.limit ?? 400;
	const anchor = parseLocalDate(input.anchorDate);
	const windowStart = Math.max(parseLocalDate(input.from), anchor);
	const windowEnd = input.recurrence.until
		? Math.min(parseLocalDate(input.to), parseLocalDate(input.recurrence.until))
		: parseLocalDate(input.to);

	const out: Occurrence[] = [];
	for (let stamp = windowStart; stamp <= windowEnd && out.length < limit; stamp += DAY_MS) {
		const localDate = formatLocalDate(stamp);
		if (!matchesRecurrence(input.recurrence, input.anchorDate, localDate)) continue;
		// The wall clock is the same on every occurrence; the instant is not. A 12:00 Thursday
		// event is 12:00 local before and after the October transition, an hour apart in UTC.
		out.push({
			localDate,
			startsAt: zonedWallClockToInstant(localDate, input.startTime, timeZone),
			endsAt: input.endTime ? zonedWallClockToInstant(localDate, input.endTime, timeZone) : null
		});
	}
	return out;
}

/** One Nynorsk phrase for the rule, for the form and the event card. */
export function describeRecurrence(rule: Recurrence): string {
	const interval = Math.max(1, Math.trunc(rule.interval));
	const days = rule.weekdays
		.slice()
		.sort((a, b) => a - b)
		.map((d) => WEEKDAY_NAMES[d]);
	const dayList =
		days.length <= 1
			? (days[0] ?? '')
			: `${days.slice(0, -1).join(', ')} og ${days[days.length - 1]}`;

	let phrase: string;
	if (rule.freq === 'daily') {
		phrase = interval === 1 ? 'kvar dag' : `kvar ${interval}. dag`;
	} else if (rule.freq === 'weekly') {
		phrase =
			interval === 1
				? `kvar ${dayList}`
				: interval === 2
					? `annakvar ${dayList}`
					: `kvar ${interval}. veke på ${dayList}`;
	} else {
		const ordinals: Record<number, string> = {
			1: 'første',
			2: 'andre',
			3: 'tredje',
			4: 'fjerde',
			5: 'femte'
		};
		const which = rule.nth === -1 ? 'siste' : (ordinals[rule.nth ?? 1] ?? 'første');
		phrase = `${which} ${dayList} i månaden`;
	}

	return rule.until ? `${phrase}, til ${rule.until}` : phrase;
}

/**
 * RFC 5545 RRULE for the iCal feed. We emit this format but never parse it — see the module
 * comment. `UNTIL` is a local date, so it is emitted as a DATE value, not a UTC instant.
 */
export function toRRule(rule: Recurrence): string {
	const parts = [`FREQ=${rule.freq.toUpperCase()}`];
	const interval = Math.max(1, Math.trunc(rule.interval));
	if (interval !== 1) parts.push(`INTERVAL=${interval}`);

	const ICAL_DAYS: Record<Weekday, string> = {
		1: 'MO',
		2: 'TU',
		3: 'WE',
		4: 'TH',
		5: 'FR',
		6: 'SA',
		7: 'SU'
	};
	if (rule.freq !== 'daily' && rule.weekdays.length > 0) {
		const days = rule.weekdays
			.slice()
			.sort((a, b) => a - b)
			.map((d) => ICAL_DAYS[d]);
		// Monthly nth is expressed as a prefix on the day (`1MO`), not BYSETPOS — simpler, and the
		// only monthly shape this rule can hold anyway.
		parts.push(
			`BYDAY=${days.map((d) => (rule.freq === 'monthly' && rule.nth ? `${rule.nth}${d}` : d)).join(',')}`
		);
	}
	if (rule.until) parts.push(`UNTIL=${rule.until.replace(/-/g, '')}`);
	return `RRULE:${parts.join(';')}`;
}
