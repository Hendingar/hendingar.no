import { z } from 'zod';
import { WEEKDAY_NAMES, WEEKDAYS, type Weekday } from './recurrence.ts';

/**
 * When a standing activity meets: "tysdag og onsdag 18:00–19:30, laurdag 11:30–13:00".
 *
 * A football squad, a choir, a swimming session. It runs for a season, so `events.kind` already
 * files it as `standing` from its dates alone (ADR 0013) — but unlike a museum it is not simply
 * open, it meets at given times on given days, and a reader cannot go without knowing them.
 *
 * ## Why this is not an `event_series`
 *
 * ADR 0009 materialises a series as one row per occurrence, because a recurring concert belongs in
 * the day list. These do not: 119 activities meeting two or three times a week would put several
 * hundred training sessions into every week of the listing, which is the flood ADR 0013 exists to
 * stop. So an activity is ONE standing row, and this is its timetable — data to show, never
 * expanded into dates. See docs/decisions/0021-weekly-activities.md.
 *
 * ## Why a wall clock, not an instant
 *
 * "18:00" is 18:00 in Bømlo in January and in July. The times are stored as the source states them
 * and are only ever displayed, so no zone is needed until something wants an instant — and nothing
 * here does.
 */

/**
 * How often the listed weekdays come round. The aktivitetforalle platform's vocabulary, which is
 * the only source that states one; its own page words each value, and the labels below are those
 * words, so a reader who clicks through sees the same thing.
 */
export const WEEKLY_CADENCES = [
	'weekly',
	'even-weeks',
	'odd-weeks',
	'first-of-month',
	'last-of-month'
] as const;
export type WeeklyCadence = (typeof WEEKLY_CADENCES)[number];

const CADENCE_LABELS: Record<WeeklyCadence, string> = {
	weekly: 'Kvar veke',
	'even-weeks': 'Partalsveker',
	'odd-weeks': 'Oddetalsveker',
	'first-of-month': 'Første veka i månaden',
	'last-of-month': 'Siste veka i månaden'
};

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const weeklySlotSchema = z.object({
	/** ISO weekday, 1 = Monday — the numbering `recurrence.ts` already uses. */
	weekday: z.literal(WEEKDAYS),
	from: clock,
	/** Null where the source states a start and nothing more. */
	to: clock.nullable()
});
export type WeeklySlot = z.infer<typeof weeklySlotSchema>;

export const weeklyHoursSchema = z.object({
	cadence: z.enum(WEEKLY_CADENCES),
	/** At least one. An activity with no times is not something we can tell anyone when to go to. */
	slots: z.array(weeklySlotSchema).min(1)
});
export type WeeklyHours = z.infer<typeof weeklyHoursSchema>;

/** "Tysdag 18:00–19:30". Capitalised, because each one starts a line. */
function capitalise(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

function span(slot: WeeklySlot): string {
	return slot.to ? `${slot.from}–${slot.to}` : `frå ${slot.from}`;
}

function joinDays(days: Weekday[]): string {
	const names = days.map((d) => WEEKDAY_NAMES[d]);
	return names.length <= 1
		? (names[0] ?? '')
		: `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`;
}

export type WeeklyHoursText = {
	/** "Partalsveker". Null for an ordinary weekly activity, which needs no qualifier. */
	cadence: string | null;
	/** One line per distinct time, days in week order: ["Måndag og torsdag 18:00–19:30"]. */
	lines: string[];
};

/**
 * The timetable as a reader should see it.
 *
 * Days that share the same hours share a line — "måndag, onsdag og torsdag 06:00–07:30" rather
 * than three lines saying the same thing — but only when the hours are identical: a squad that
 * trains 18:00 on Tuesday and 19:30 on Thursday gets two lines, because merging them would state
 * a time that is wrong on one of the days.
 *
 * The cadence is returned apart rather than glued on, so a card can put it in a chip and a page in
 * its own line. "Kvar veke" is left out: it is what a timetable means when it says nothing else.
 */
export function describeWeeklyHours(hours: WeeklyHours): WeeklyHoursText {
	const byTime = new Map<string, Weekday[]>();
	const ordered = hours.slots
		.slice()
		.sort((a, b) => a.weekday - b.weekday || a.from.localeCompare(b.from));
	for (const slot of ordered) {
		const key = span(slot);
		const days = byTime.get(key) ?? [];
		if (!days.includes(slot.weekday)) days.push(slot.weekday);
		byTime.set(key, days);
	}
	const lines = [...byTime.entries()]
		// A Map keeps insertion order, which is already week order of each group's first day.
		.map(([time, days]) => `${capitalise(joinDays(days))} ${time}`);
	return {
		cadence: hours.cadence === 'weekly' ? null : CADENCE_LABELS[hours.cadence],
		lines
	};
}
