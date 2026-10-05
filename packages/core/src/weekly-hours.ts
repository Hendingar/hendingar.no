import { z } from 'zod';
import { addDays, isoWeekKey, weekdayIndex } from './datetime.ts';
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

/**
 * Do two timetables say the same thing?
 *
 * By content, not by spelling. Importers build the object in a fixed key order and jsonb hands it
 * back sorted by key length, so `JSON.stringify` would call every row changed on every run — and an
 * importer that reports everything "updated" daily buries the one day a source really moved.
 *
 * Slot order counts: every importer emits slots in week order, so a reordering is a real change.
 */
export function sameWeeklyHours(a: WeeklyHours | null, b: WeeklyHours | null): boolean {
	if (a === null || b === null) return a === b;
	return (
		a.cadence === b.cadence &&
		a.slots.length === b.slots.length &&
		a.slots.every(
			(slot, i) =>
				slot.weekday === b.slots[i]?.weekday &&
				slot.from === b.slots[i]?.from &&
				slot.to === b.slots[i]?.to
		)
	);
}

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

/**
 * The slots an activity actually meets in on one calendar date, cadence included.
 *
 * A timetable says "sundag 11:00"; a reader asks "is it on THIS sunday". For a weekly activity the
 * answer is the weekday alone. For the rest it is a fact about the date, and saying yes on the
 * wrong week is how somebody stands outside a locked church:
 *
 * - **Partalsveker / oddetalsveker** are ISO week numbers, which is how a Norwegian calendar numbers
 *   them. 1 January 2027 is in week 53 of 2026, and `isoWeekKey` already knows that.
 * - **Første / siste veka i månaden** is the first or last time that weekday comes round in the
 *   month — the 1st–7th, or the last seven days. Not "the ISO week containing the 1st", which would
 *   put a Wednesday meeting on 29 September when the month it belongs to is October.
 *
 * `localDate` is a wall-clock date (`YYYY-MM-DD`) in the activity's own zone, so nothing here
 * depends on where the code runs.
 */
export function slotsOn(hours: WeeklyHours, localDate: string): WeeklySlot[] {
	const weekday = WEEKDAYS[weekdayIndex(localDate)];
	const slots = hours.slots.filter((s) => s.weekday === weekday);
	if (slots.length === 0) return [];

	const week = Number(isoWeekKey(localDate).split('-W')[1]);
	const dayOfMonth = Number(localDate.slice(8, 10));
	const nextWeekSameMonth = addDays(localDate, 7).slice(0, 7) === localDate.slice(0, 7);

	const meets: Record<WeeklyCadence, boolean> = {
		weekly: true,
		'even-weeks': week % 2 === 0,
		'odd-weeks': week % 2 === 1,
		'first-of-month': dayOfMonth <= 7,
		'last-of-month': !nextWeekSameMonth
	};
	return meets[hours.cadence] ? slots : [];
}

/**
 * Who an activity is for, as the age bands a reader picks from.
 *
 * The source states an age range per activity — "8–10", "62–100" — or "alle". A band matches when
 * the range OVERLAPS it, not when it sits inside: badminton for 16–100 is genuinely open to a
 * sixteen-year-old, and hiding it from "Ungdom" would be the site deciding something the club did
 * not. No range at all matches every band, because that is what the source means by it.
 *
 * Bands rather than a free age input: four taps cover the question people actually have ("is
 * there anything for my 9-year-old / for me / for my mother"), and a number box on a phone is a
 * keyboard in the way of an answer.
 */
export const AGE_BANDS = [
	{ key: 'born', label: 'Born', from: 0, to: 12 },
	{ key: 'ungdom', label: 'Ungdom', from: 13, to: 19 },
	{ key: 'vaksne', label: 'Vaksne', from: 20, to: 66 },
	{ key: 'seniorar', label: 'Seniorar', from: 67, to: 150 }
] as const;
export type AgeBand = (typeof AGE_BANDS)[number]['key'];

export function isAgeBand(raw: string | null): raw is AgeBand {
	return AGE_BANDS.some((b) => b.key === raw);
}

export function fitsAgeBand(ageFrom: number | null, ageTo: number | null, band: AgeBand): boolean {
	const b = AGE_BANDS.find((x) => x.key === band);
	if (!b) return true;
	const from = ageFrom ?? 0;
	const to = ageTo ?? 150;
	return from <= b.to && to >= b.from;
}
