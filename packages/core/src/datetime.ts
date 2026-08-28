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

const DAY: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

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

	return new Intl.DateTimeFormat(DATE_LOCALE, { ...DAY, timeZone: 'UTC' }).format(date);
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
