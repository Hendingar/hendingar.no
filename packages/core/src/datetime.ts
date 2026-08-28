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

/** Machine-readable value for `<time datetime>`. Always the instant, in UTC. */
export function machineDateTime(instant: Date): string {
	return instant.toISOString();
}
