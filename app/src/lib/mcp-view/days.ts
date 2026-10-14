import { formatDayLabel, MONTH_NAMES } from '@hendingar/core/datetime';
import type { ViewEvent } from '@hendingar/core/public-event';

/**
 * The MCP App view's arithmetic, apart from the component so it can be tested without a frame.
 *
 * Every date here is read off the ISO string the server wrote with the venue's own offset
 * (`2026-10-18T20:00:00+02:00`), so its first ten characters ARE the venue's calendar day and the
 * next five its wall clock. Nothing is re-derived from an instant in the visitor's zone — which is
 * the bug CLAUDE.md's "never call toLocaleString" exists to prevent, and an iframe in somebody's
 * browser in another country is exactly where it would bite.
 */

export type Day = { date: string; label: string; events: ViewEvent[] };

const dayOf = (iso: string) => iso.slice(0, 10);

/**
 * Events grouped under the day they are on, soonest first.
 *
 * An event that began before today and is still running is listed under today, as the site's own
 * listing does — a festival on its third day is something to go to now, not something in the past.
 */
export function groupByDay(events: readonly ViewEvent[], today: string): Day[] {
	const byDay = new Map<string, ViewEvent[]>();
	const sorted = [...events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
	for (const event of sorted) {
		const start = dayOf(event.startsAt);
		const ongoing = start < today && event.endsAt !== null && dayOf(event.endsAt) >= today;
		const date = ongoing ? today : start;
		byDay.set(date, [...(byDay.get(date) ?? []), event]);
	}
	return [...byDay.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, list]) => ({ date, label: formatDayLabel(date, today), events: list }));
}

/**
 * When, as a card says it: "20:00", "18:00–21:00", or "til 23. oktober" for something that runs
 * for days. Null for a weekly activity, whose timetable says it better than a start time can.
 */
export function timeOf(event: ViewEvent): string | null {
	if (event.weeklyHours) return null;
	const start = event.startsAt.slice(11, 16);
	if (!event.endsAt) return start;
	if (dayOf(event.endsAt) !== dayOf(event.startsAt)) {
		const [, month, day] = dayOf(event.endsAt).split('-').map(Number);
		return `til ${day}. ${MONTH_NAMES[(month ?? 1) - 1] ?? ''}`;
	}
	const end = event.endsAt.slice(11, 16);
	return end === start ? start : `${start}–${end}`;
}

/** "Stord kulturhus, Stord" — the place without saying the municipality twice. */
export function placeOf(event: ViewEvent): string | null {
	const { venue, municipality } = event;
	if (!venue) return municipality;
	if (!municipality || venue.includes(municipality)) return venue;
	return `${venue}, ${municipality}`;
}
