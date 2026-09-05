/**
 * Event date formatting. One implementation, because getting this wrong is invisible.
 *
 * Two traps, both measured rather than assumed:
 *
 * 1. **`nn-NO` does not exist in browser ICU.** Node resolves it fine (`12. sep., 20:00`), but
 *    Chromium reports `supportedLocalesOf(['nn-NO']) === []` and falls back to the *visitor's*
 *    locale — so an English-language browser renders `Sep 12, 08:00 PM`. That means the server and
 *    the client disagree, and a Norwegian reader sees `9/12/2026` for an event on 12 September and
 *    reasonably reads it as 9 December. We format with `nb-NO`, which browsers do carry and which
 *    has identical date patterns and month abbreviations to Nynorsk.
 *
 * 2. **A timestamptz is an instant, not a wall clock.** Always pass the venue's zone. Never let
 *    `Intl` default to the runtime zone.
 */

/** Browsers don't ship `nn`; `nb` renders identically for dates and is universally available. */
export const DATE_LOCALE = 'nb-NO';

/** Fallback only for venues predating the timezone column. Prefer the venue's own value. */
export const DEFAULT_TIME_ZONE = 'Europe/Oslo';

const CARD: Intl.DateTimeFormatOptions = {
	day: '2-digit',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit'
};

const FULL: Intl.DateTimeFormatOptions = {
	weekday: 'short',
	day: '2-digit',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit'
};

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, style: 'card' | 'full'): Intl.DateTimeFormat {
	const key = `${style}:${timeZone}`;
	let f = cache.get(key);
	if (!f) {
		f = new Intl.DateTimeFormat(DATE_LOCALE, {
			...(style === 'card' ? CARD : FULL),
			timeZone
		});
		cache.set(key, f);
	}
	return f;
}

/**
 * Render an instant as local wall-clock time at the venue.
 *
 * `card` omits the year — fine inside a list scoped to the near future. `full` includes weekday and
 * year, for anywhere the date stands alone.
 */
export function formatEventTime(
	instant: Date,
	timeZone: string | null | undefined,
	style: 'card' | 'full' = 'card'
): string {
	return formatter(timeZone || DEFAULT_TIME_ZONE, style).format(instant);
}

/*
 * The calendar vocabulary, as data rather than from `Intl`.
 *
 * `nn-NO` does not exist in browser ICU — see the note at the top of this file — so every `Intl`
 * date label on this site is really Bokmål: "lørdag", "søndag". That was invisible while the only
 * spelled-out date was a day heading nobody reads letter by letter. A calendar puts a weekday
 * column header directly above a spelled-out date, and "LA" over "lørdag" reads as a bug in a site
 * that is Nynorsk everywhere else.
 *
 * Month names are identical in both written standards; only the weekdays actually differ. Both are
 * listed here anyway so there is one table rather than a table and an `Intl` call that have to be
 * kept agreeing with each other.
 */

/** January first, so `MONTH_NAMES[month - 1]` reads a 1-based month number. */
export const MONTH_NAMES = [
	'januar',
	'februar',
	'mars',
	'april',
	'mai',
	'juni',
	'juli',
	'august',
	'september',
	'oktober',
	'november',
	'desember'
] as const;

/**
 * Monday first, because that is how a Norwegian calendar is drawn — the week starts on måndag and
 * the weekend is the last two columns. A Sunday-first grid would put laurdag and sundag on
 * opposite edges.
 */
export const WEEKDAY_NAMES = [
	'måndag',
	'tysdag',
	'onsdag',
	'torsdag',
	'fredag',
	'laurdag',
	'sundag'
] as const;

/** Column headers. Two letters, because seven three-letter headers do not fit 320px. */
export const WEEKDAY_ABBR = ['må', 'ty', 'on', 'to', 'fr', 'la', 'su'] as const;

/** `YYYY-MM-DD` that is also a day that exists. `2026-02-31` matches the shape and is not a date. */
export function isCalendarDate(raw: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
	const [y, m, d] = raw.split('-').map(Number);
	if (y === undefined || m === undefined || d === undefined) return false;
	if (m < 1 || m > 12 || d < 1) return false;
	// Noon UTC throughout: a date built at midnight can be moved across a day boundary by any
	// offset arithmetic that follows, and this module exists to stop exactly that.
	const probe = new Date(Date.UTC(y, m - 1, d, 12));
	return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Which column a calendar date falls in: 0 = måndag … 6 = sundag. */
export function weekdayIndex(localDate: string): number {
	const [y, m, d] = localDate.split('-').map(Number);
	const day = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)).getUTCDay();
	// getUTCDay is Sunday-first. Rotate so måndag is 0.
	return (day + 6) % 7;
}

/**
 * A calendar date spelled out in full: "Laurdag 12. september 2026".
 *
 * The year is included because this is used where a date stands alone — a page title, a heading on
 * a URL somebody bookmarked — and "12. september" on its own is only unambiguous for a reader who
 * already knows which year they are looking at.
 */
export function formatCalendarDate(localDate: string): string {
	const [y, m, d] = localDate.split('-').map(Number);
	if (y === undefined || m === undefined || d === undefined) return localDate;
	const weekday = WEEKDAY_NAMES[weekdayIndex(localDate)] ?? '';
	return `${capitalise(weekday)} ${d}. ${MONTH_NAMES[m - 1] ?? ''} ${y}`;
}

/** A month, spelled out: "September 2026". */
export function formatMonthName(monthKey: string): string {
	const [y, m] = monthKey.split('-').map(Number);
	if (y === undefined || m === undefined) return monthKey;
	return `${capitalise(MONTH_NAMES[m - 1] ?? '')} ${y}`;
}

function capitalise(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Heading for a day group: "I dag", "I morgon", or a spelled-out date.
 *
 * Takes calendar dates as `YYYY-MM-DD` strings already resolved in the relevant zone, rather than
 * instants — grouping by day is a calendar question, and re-deriving the day from an instant here
 * would reintroduce exactly the timezone bug this module exists to prevent.
 */
export function formatDayLabel(localDate: string, todayLocalDate: string): string {
	if (localDate === todayLocalDate) return 'I dag';

	const [y, m, d] = localDate.split('-').map(Number);
	const [ty, tm, td] = todayLocalDate.split('-').map(Number);
	if (y == null || m == null || d == null || ty == null || tm == null || td == null) {
		return localDate;
	}
	// Noon UTC, so the label can never slip a day through an offset.
	const date = new Date(Date.UTC(y, m - 1, d, 12));
	const tomorrow = new Date(Date.UTC(ty, tm - 1, td, 12));
	tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
	if (date.getTime() === tomorrow.getTime()) return 'I morgon';

	// Nynorsk from the table above rather than Intl, which only speaks Bokmål here. The year is
	// left off: a day group only ever appears inside a list scoped to the near future.
	return `${capitalise(WEEKDAY_NAMES[weekdayIndex(localDate)] ?? '')} ${d}. ${MONTH_NAMES[m - 1] ?? ''}`;
}

/** Time only — the day is already carried by the group heading. */
export function formatEventClock(instant: Date, timeZone: string | null | undefined): string {
	return new Intl.DateTimeFormat(DATE_LOCALE, {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: timeZone || DEFAULT_TIME_ZONE
	}).format(instant);
}

/** Machine-readable value for `<time datetime>`. Always the instant, in UTC. */
export function machineDateTime(instant: Date): string {
	return instant.toISOString();
}

/** The zone's UTC offset, in ms, at a given instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', {
			timeZone,
			hour12: false,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		})
			.formatToParts(instant)
			.map((p) => [p.type, p.value])
	);
	const asIfUtc = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour) % 24,
		Number(parts.minute),
		Number(parts.second)
	);
	return asIfUtc - instant.getTime();
}

/**
 * A wall-clock date and time in a zone → the instant it denotes.
 *
 * A poster says "laurdag 14. mars, 20:00". That is a wall clock, not an instant, and turning one
 * into the other needs the zone's offset *at that moment* — which changes twice a year. Building
 * the Date in the server's local zone would be wrong for every deployment outside Norway, and
 * wrong twice a year even inside it.
 *
 * The offset is applied, then re-checked: a naive single pass lands on the wrong side of a DST
 * transition for times near the boundary.
 */
/**
 * An instant back to the wall clock somebody would read off a poster, in a given zone.
 *
 * The inverse of `zonedWallClockToInstant`, and needed for the same reason: a form holds a date and
 * a time, the database holds an instant, and turning one into the other in the *server's* zone puts
 * a 20:00 concert into the box as 19:00 for anyone deploying outside Norway.
 *
 * `en-CA` because it formats as `YYYY-MM-DD` — the one locale that gives the shape an `<input
 * type="date">` requires without reassembling parts by hand.
 */
export function instantToZonedWallClock(
	instant: Date,
	timeZone: string = DEFAULT_TIME_ZONE
): { date: string; time: string } {
	const date = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(instant);

	const time = new Intl.DateTimeFormat('en-GB', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(instant);

	return { date, time };
}

export function zonedWallClockToInstant(
	localDate: string,
	localTime: string,
	timeZone: string = DEFAULT_TIME_ZONE
): Date {
	const [year, month, day] = localDate.split('-').map(Number);
	const [hour, minute] = localTime.split(':').map(Number);
	if ([year, month, day, hour, minute].some((n) => n === undefined || Number.isNaN(n))) {
		throw new Error(`invalid local date/time: ${localDate} ${localTime}`);
	}

	const naive = Date.UTC(year!, month! - 1, day!, hour!, minute!);
	const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);
	const secondPass = naive - zoneOffsetMs(new Date(firstPass), timeZone);
	return new Date(secondPass);
}

/**
 * Format keystrokes into a 24-hour `HH:MM` as the person types.
 *
 * `<input type="time">` renders in the *browser's* locale, not the page's, and nothing in HTML or
 * CSS can override that — an English-locale browser shows "04:30 PM" on a Nynorsk form. Every
 * displayed time elsewhere is pinned to nb-NO (see the formatter above); the native input was the
 * one place we could not pin, so the form uses a text field and this function.
 *
 * Pure, so the fiddly part is testable: a leading digit of 3 or more cannot begin a two-digit hour
 * (there is no 30:00), so "930" means 09:30 while "1930" means 19:30. Without that rule a person
 * typing 9-3-0 on a numeric keypad gets "90:3".
 */
export function formatTimeDigits(raw: string): string {
	const digits = raw.replace(/\D/g, '').slice(0, 4);
	if (digits.length <= 1) return digits;

	const singleDigitHour = digits[0]! >= '3';
	const hour = singleDigitHour ? `0${digits[0]}` : digits.slice(0, 2);
	const minutes = digits.slice(singleDigitHour ? 1 : 2, singleDigitHour ? 3 : 4);
	return minutes.length > 0 ? `${hour}:${minutes}` : hour;
}

/*
 * ---------------------------------------------------------------------------------------------
 * ISO weeks
 *
 * The week view and the horizon rail are both addressed by week, so a week needs a spelling that
 * survives a URL: `2026-W37`. ISO 8601 is the only sane choice — it is what Norwegian calendars
 * print in the margin, and "veke 37" is how people here actually refer to a week.
 *
 * Two traps, both handled by anchoring on Thursday:
 *
 *   1. A week belongs to the year its **Thursday** falls in, so 29 December 2025 is `2026-W01`
 *      and 1 January 2027 is `2026-W53`. Deriving the year from the date's own year puts those
 *      two days a whole year away from the week they are in.
 *   2. A year has 53 weeks only sometimes. `2026-W53` is real; `2025-W53` is not. A regex cannot
 *      tell them apart, which is the same class of bug as `2026-02-31` — see `isIsoWeek`.
 *
 * Everything below builds its dates at **noon UTC**, so no offset arithmetic can slide a result
 * onto the day before. Same rule as the rest of this module.
 * ---------------------------------------------------------------------------------------------
 */

const DAY_MS = 86_400_000;

/** A UTC date back to `YYYY-MM-DD`. */
function toLocalDate(date: Date): string {
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
		date.getUTCDate()
	).padStart(2, '0')}`;
}

function atNoonUtc(localDate: string): Date {
	const [y, m, d] = localDate.split('-').map(Number);
	return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12));
}

/** The måndag of the ISO week a date falls in. */
function mondayOf(date: Date): Date {
	const monday = new Date(date.getTime());
	monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
	return monday;
}

/** Step a calendar date by whole days. Rolls months and years. */
export function addDays(localDate: string, delta: number): string {
	const date = atNoonUtc(localDate);
	date.setUTCDate(date.getUTCDate() + delta);
	return toLocalDate(date);
}

/**
 * The ISO week a calendar date belongs to, as `YYYY-Www`.
 *
 * The year is the week's, not the date's: 1 January 2027 is a Friday, so it is still `2026-W53`.
 */
export function isoWeekKey(localDate: string): string {
	const monday = mondayOf(atNoonUtc(localDate));
	// Thursday decides the year the whole week belongs to.
	const thursday = new Date(monday.getTime() + 3 * DAY_MS);
	const isoYear = thursday.getUTCFullYear();
	const firstMonday = mondayOf(new Date(Date.UTC(isoYear, 0, 4, 12)));
	const week = Math.round((monday.getTime() - firstMonday.getTime()) / (7 * DAY_MS)) + 1;
	return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** The måndag that opens an ISO week, as `YYYY-MM-DD`. */
export function isoWeekStart(weekKey: string): string {
	const [year, week] = weekKey.split('-W').map(Number);
	// 4 January is in week 1 by definition, whichever weekday it happens to be.
	const firstMonday = mondayOf(new Date(Date.UTC(year ?? 1970, 0, 4, 12)));
	return toLocalDate(new Date(firstMonday.getTime() + ((week ?? 1) - 1) * 7 * DAY_MS));
}

/** The seven calendar dates of an ISO week, måndag first. */
export function isoWeekDates(weekKey: string): string[] {
	const monday = isoWeekStart(weekKey);
	return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Step a week key by whole weeks. Crosses the year boundary by recomputing, never by arithmetic. */
export function shiftWeek(weekKey: string, delta: number): string {
	return isoWeekKey(addDays(isoWeekStart(weekKey), delta * 7));
}

/**
 * `YYYY-Www` that is also a week that exists.
 *
 * The shape is not enough: `2025-W53` matches it and there is no such week — 2025 has 52. Checked
 * by round-tripping through the måndag, which lands in the neighbouring year for a week that
 * overflows and so fails to spell itself back.
 */
export function isIsoWeek(raw: string): boolean {
	if (!/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(raw)) return false;
	return isoWeekKey(isoWeekStart(raw)) === raw;
}

/** "Veke 37" — how a week is named in the margin of a Norwegian calendar. */
export function formatWeekName(weekKey: string): string {
	return `Veke ${Number(weekKey.slice(6))}`;
}

/**
 * The span a week covers, spelled for a human: "7.–13. september 2026".
 *
 * Collapses whatever the two ends share, because a week that runs from September into October
 * needs both month names and one that does not is only cluttered by the repetition.
 */
export function formatWeekRange(weekKey: string): string {
	const dates = isoWeekDates(weekKey);
	const first = dates[0] ?? '';
	const last = dates[6] ?? '';
	const [fy, fm, fd] = first.split('-').map(Number);
	const [ly, lm, ld] = last.split('-').map(Number);
	const fromMonth = MONTH_NAMES[(fm ?? 1) - 1] ?? '';
	const toMonth = MONTH_NAMES[(lm ?? 1) - 1] ?? '';
	if (fy !== ly) return `${fd}. ${fromMonth} ${fy} – ${ld}. ${toMonth} ${ly}`;
	if (fm !== lm) return `${fd}. ${fromMonth} – ${ld}. ${toMonth} ${ly}`;
	return `${fd}.–${ld}. ${toMonth} ${ly}`;
}
