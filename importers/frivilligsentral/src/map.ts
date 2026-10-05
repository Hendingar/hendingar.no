import { addDays, weekdayIndex, zonedWallClockToInstant } from '@hendingar/core/datetime';
import { fromLine } from '@hendingar/core/address';
import { WEEKDAYS, WEEKDAY_NAMES, type Weekday } from '@hendingar/core/recurrence';
import { slugify } from '@hendingar/core/slug';
import { classifyEventKind } from '@hendingar/core/standing';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import { weeklyHoursSchema, type WeeklyHours, type WeeklySlot } from '@hendingar/core/weekly-hours';
import type { ListingPage, UpstreamItem } from './api.ts';
import { listingUrl, type FsSite } from './sites.ts';

/**
 * Pure mapping: the listing's dated occurrences → our rows. No I/O, no clock, no randomness.
 *
 * ## The shape (ADR 0021)
 *
 * The page lists 674 dated items, and they are four things: Eldretreff on Buneset every Tuesday,
 * Middagsservering every Tuesday, Eldretreff on Leirvikstova every Wednesday, Seniordata every
 * Thursday — each printed once per week out to 2029 or 2030. Imported as dated events they would
 * be the flood ADR 0013 and 0021 exist to stop: four rows in every week's listing, for four years.
 *
 * So occurrences are grouped back into what they are — an activity that meets weekly — and each
 * becomes ONE standing row with a timetable in `events.weekly_hours`, served under "Faste
 * aktivitetar" on /alltid-ope. The rules, in the order they are applied:
 *
 * 1. **A series is title + place.** One activity, one row, one `external_id`.
 * 2. **A slot is weekday + from + to within a series.** Its dates are what the cadence is read from.
 * 3. **A slot that spans a season — `standing` by `classifyEventKind`, the same rule the generated
 *    `events.kind` column applies — must be weekly by `classifyCadence`, or the whole series is
 *    rejected by name.** ADR 0021: an interval we have no word for is a rejected row, never a
 *    quiet default. A fortnightly group shown as weekly sends somebody to a locked door.
 * 4. **A slot that does not span a season is a set of appointments**, and each occurrence is a
 *    dated event: a one-off "Julemiddag" on a Tuesday, a three-week course, the Eldretreff that is
 *    moved to 12.00 the week before Christmas. They are things that happen at a time (ADR 0013),
 *    so they belong in the day list — and the standing slot they sit beside does not absorb them.
 */

/**
 * The source states no category, and nothing is guessed from a title.
 *
 * `anna`, as aktivitetforalle files "Fritid og sosialt" — the tag Bømlo's portal puts on its own
 * seniortreff and seniortrim. "Middagsservering" reads like `mat-og-drikke`, but a keyword table
 * over titles is a per-source taxonomy by another name, and the next title it meets it gets wrong.
 */
const CATEGORY: CategorySlug = 'anna';

/** The CMS prints Bokmål; the Nynorsk spellings are accepted too, in case a site is set to them. */
const WEEKDAY_BY_NAME: Record<string, Weekday> = {
	mandag: 1,
	måndag: 1,
	tirsdag: 2,
	tysdag: 2,
	onsdag: 3,
	torsdag: 4,
	fredag: 5,
	lørdag: 6,
	laurdag: 6,
	søndag: 7,
	sundag: 7
};

const MONTH_BY_NAME: Record<string, number> = {
	januar: 1,
	februar: 2,
	mars: 3,
	april: 4,
	mai: 5,
	juni: 6,
	juli: 7,
	august: 8,
	september: 9,
	oktober: 10,
	november: 11,
	desember: 12
};

/**
 * The longest break a weekly activity may take and stay weekly: eight weeks.
 *
 * A summer break is six to eight weeks; Christmas and Easter are one or two. Anything longer is
 * two seasons, and two seasons with nothing said about the gap is not a timetable we can state.
 */
export const MAX_BREAK_DAYS = 56;

/**
 * At least three gaps in four must be exactly one week.
 *
 * Weekly with holidays skipped stays well above this — a school-year activity skips perhaps four
 * weeks in forty. Fortnightly is 0%, and "roughly every other week" lands around half. Both are
 * rejected rather than called weekly.
 */
export const MIN_WEEKLY_SHARE = 0.75;

export type MappedEvent = {
	externalId: string;
	title: string;
	category: CategorySlug;
	startsAt: Date;
	endsAt: Date | null;
	venueName: string | null;
	venueSlug: string | null;
	/** "Buneset 9" when the place line is an address; null when it is a room's name. */
	venueStreet: string | null;
	sourceUrl: string;
	organizerName: string;
	/** Set on a weekly activity; null on a dated occurrence. */
	weeklyHours: WeeklyHours | null;
};

export type MapFailure = { externalId: string; title: string; problem: string };

/** One dated item, read: where, when, and which page. */
export type Occurrence = {
	title: string;
	place: string | null;
	/** Wall-clock calendar date in the site's zone, `YYYY-MM-DD`. */
	date: string;
	weekday: Weekday;
	/** Wall clocks, "11:00". The page prints "11.00". */
	from: string;
	to: string | null;
	href: string | null;
};

/** "11.00" → "11:00", or null if it is not a time of day. */
function clock(hours: string, minutes: string): string | null {
	const h = Number(hours);
	const m = Number(minutes);
	if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) return null;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * "11.00 - 13.30: Eldretreff Buneset" → times and title.
 *
 * The times are the source's wall clock and stay one. Nothing in the page states an offset or a
 * zone, so there is no claim to cross-check and nothing to get wrong until `zonedWallClockToInstant`
 * resolves the date against Europe/Oslo — and the event's own page prints the same clock ("Kl.
 * 11:00 - 13:30"), checked for Eldretreff Buneset on 6 October.
 *
 * An end time is optional; a start time is not. A heading with no time at all would be a shape this
 * page has never shown, and is reported rather than imported at midnight.
 */
export function parseHeading(
	heading: string
): { from: string; to: string | null; title: string } | { problem: string } {
	const match = /^(\d{1,2})[.:](\d{2})(?:\s*-\s*(\d{1,2})[.:](\d{2}))?\s*:\s*(.+)$/.exec(
		heading.trim()
	);
	if (!match) return { problem: `no time in heading: ${heading}` };
	const from = clock(match[1]!, match[2]!);
	const to = match[3] && match[4] ? clock(match[3], match[4]) : null;
	const title = match[5]!.trim().replace(/\s+/g, ' ');
	if (!from || (match[3] && !to)) return { problem: `unreadable time in heading: ${heading}` };
	if (!title) return { problem: `no title in heading: ${heading}` };
	return { from, to, title };
}

/**
 * The item's printed date → a calendar date, checked against the weekday printed beside it.
 *
 * The year comes from the item when it states one, and from the page otherwise — see `api.ts` for
 * why the year is carried that way. The weekday check is what makes that safe: a date moved one
 * year either way always lands on a different weekday, so a year read wrong at New Year is rejected
 * by name instead of published a year out. Every one of the 674 items in the committed page passes.
 */
export function resolveDate(
	item: UpstreamItem,
	pageYear: number
): { date: string; weekday: Weekday } | { problem: string } {
	const month = MONTH_BY_NAME[item.month.trim().toLowerCase()];
	const stated = WEEKDAY_BY_NAME[item.weekday.trim().toLowerCase()];
	if (!month) return { problem: `unknown month: ${item.month}` };
	if (!stated) return { problem: `unknown weekday: ${item.weekday}` };

	const year = item.year ?? pageYear;
	const date = `${year}-${String(month).padStart(2, '0')}-${String(item.day).padStart(2, '0')}`;
	// `addDays(…, 0)` round-trips through a real calendar, so 31 November comes back as 1 December.
	if (addDays(date, 0) !== date) return { problem: `no such date: ${date}` };

	const actual = WEEKDAYS[weekdayIndex(date)]!;
	if (actual !== stated) {
		return { problem: `${date} is a ${WEEKDAY_NAMES[actual]}, the page says ${item.weekday}` };
	}
	return { date, weekday: stated };
}

export function toOccurrence(
	item: UpstreamItem,
	pageYear: number
): Occurrence | { problem: string } {
	const heading = parseHeading(item.heading);
	if ('problem' in heading) return heading;
	const day = resolveDate(item, pageYear);
	if ('problem' in day) return { problem: `${heading.title}: ${day.problem}` };
	return {
		title: heading.title,
		place: item.place,
		date: day.date,
		weekday: day.weekday,
		from: heading.from,
		to: heading.to,
		href: item.href
	};
}

function daysBetween(a: string, b: string): number {
	const [ay, am, ad] = a.split('-').map(Number);
	const [by, bm, bd] = b.split('-').map(Number);
	return Math.round((Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / 86_400_000);
}

/**
 * How often a slot meets, from the gaps between its dates — or why we cannot say.
 *
 * **Weekly** when every gap is a whole number of weeks, no gap is longer than `MAX_BREAK_DAYS`, and
 * at least `MIN_WEEKLY_SHARE` of the gaps are exactly seven days. That admits a weekly activity
 * that skips Christmas, Easter and the summer, and nothing else.
 *
 * **Weekly is the only cadence this reads**, though `weekly_hours` has words for four more. Even
 * and odd weeks would be the natural reading of an every-14-days slot, and is wrong across a year
 * with 53 ISO weeks — 2026 is one — where a fortnightly group changes parity at New Year. First and
 * last of the month cannot be told from a few dates either. A source that published those would
 * say so in words, and this one does not, so they are rejected and named, never guessed.
 *
 * `dates` are calendar dates, sorted and distinct. Fewer than two have no gaps to read.
 */
export function classifyCadence(dates: readonly string[]): 'weekly' | { problem: string } {
	if (dates.length < 2) return { problem: 'one date is not a cadence' };
	const gaps = dates.slice(1).map((date, i) => daysBetween(dates[i]!, date));
	const weekly = gaps.filter((g) => g === 7).length;
	const ok =
		gaps.every((g) => g > 0 && g % 7 === 0 && g <= MAX_BREAK_DAYS) &&
		weekly / gaps.length >= MIN_WEEKLY_SHARE;
	if (ok) return 'weekly';

	const counts = new Map<number, number>();
	for (const g of gaps) counts.set(g, (counts.get(g) ?? 0) + 1);
	const summary = [...counts.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([gap, n]) => `${gap}d×${n}`)
		.join(', ');
	return { problem: `irregular gaps between dates (${summary})` };
}

/** `eldretreff-buneset@buneset-9`. Stable while the title and the place are, and never a time. */
export function seriesKey(title: string, place: string | null): string {
	const where = place ? slugify(place) : '';
	return where ? `${slugify(title)}@${where}` : slugify(title);
}

function instant(date: string, time: string, timeZone: string): Date {
	return zonedWallClockToInstant(date, time, timeZone);
}

function venueOf(place: string | null) {
	return {
		venueName: place,
		venueSlug: place ? slugify(place) || null : null,
		/*
		 * The place line is a room as often as an address — "Leirvikstova", "Buneset 9" — and only
		 * the second is a street. `fromLine` takes it only when it has a house number, which is the
		 * same test every other importer's address goes through.
		 */
		venueStreet: fromLine(place).street
	};
}

function sourceUrlOf(site: FsSite, href: string | null): string {
	if (!href) return listingUrl(site);
	try {
		return new URL(href, site.origin).toString();
	} catch {
		return listingUrl(site);
	}
}

export type MappedListing = {
	rows: MappedEvent[];
	failures: MapFailure[];
	/** Items read off the page, before grouping. The number to compare with what a reader sees. */
	occurrences: number;
	/** How many rows are weekly activities, and how many dated occurrences. For the run's notes. */
	standing: number;
	dated: number;
};

/**
 * The whole page → rows. See the top of this file for the rules.
 *
 * A weekly activity's `starts_at` is its first occurrence still on the listing and `ends_at` its
 * last, so `starts_at` moves forward a week at a time as the "Kommende" view drops what has
 * passed. That is a real update and is reported as one; the `external_id` does not move with it.
 */
export function mapListing(page: ListingPage, site: FsSite): MappedListing {
	const failures: MapFailure[] = [];
	const groups = new Map<string, Occurrence[]>();
	let occurrences = 0;

	for (const item of page.items) {
		occurrences += 1;
		const occurrence = toOccurrence(item, page.year);
		if ('problem' in occurrence) {
			failures.push({
				externalId: item.href ?? item.heading,
				title: item.heading,
				problem: occurrence.problem
			});
			continue;
		}
		const key = seriesKey(occurrence.title, occurrence.place);
		const list = groups.get(key) ?? [];
		list.push(occurrence);
		groups.set(key, list);
	}

	const rows: MappedEvent[] = [];
	let standing = 0;
	let dated = 0;

	for (const [key, list] of groups) {
		const first = list[0]!;

		const slots = new Map<string, Occurrence[]>();
		for (const o of list) {
			const slotKey = `${o.weekday} ${o.from} ${o.to ?? ''}`;
			const bucket = slots.get(slotKey) ?? [];
			if (!bucket.some((b) => b.date === o.date)) bucket.push(o);
			slots.set(slotKey, bucket);
		}

		const weekly: { slot: WeeklySlot; dates: Occurrence[] }[] = [];
		const appointments: Occurrence[] = [];
		let problem: string | null = null;

		for (const bucket of slots.values()) {
			const dates = bucket.slice().sort((a, b) => a.date.localeCompare(b.date));
			const head = dates[0]!;
			const tail = dates[dates.length - 1]!;
			const span = classifyEventKind(
				instant(head.date, head.from, site.timezone),
				instant(tail.date, tail.to ?? tail.from, site.timezone)
			);
			if (span !== 'standing') {
				appointments.push(...dates);
				continue;
			}
			const cadence = classifyCadence(dates.map((d) => d.date));
			if (cadence !== 'weekly') {
				const when = `${WEEKDAY_NAMES[head.weekday]} ${head.from}${head.to ? `–${head.to}` : ''}`;
				problem = `${when}: ${cadence.problem}`;
				break;
			}
			weekly.push({ slot: { weekday: head.weekday, from: head.from, to: head.to }, dates });
		}

		if (problem) {
			failures.push({ externalId: key, title: first.title, problem });
			continue;
		}

		if (weekly.length > 0) {
			const ordered = weekly
				.slice()
				.sort((a, b) => a.slot.weekday - b.slot.weekday || a.slot.from.localeCompare(b.slot.from));
			const hours = weeklyHoursSchema.safeParse({
				cadence: 'weekly',
				slots: ordered.map((w) => w.slot)
			});
			if (!hours.success) {
				failures.push({ externalId: key, title: first.title, problem: 'unreadable timetable' });
				continue;
			}
			const starts = ordered.map((w) => instant(w.dates[0]!.date, w.slot.from, site.timezone));
			const ends = ordered.map((w) => {
				const last = w.dates[w.dates.length - 1]!;
				return instant(last.date, w.slot.to ?? w.slot.from, site.timezone);
			});
			rows.push({
				externalId: key,
				title: first.title,
				category: CATEGORY,
				startsAt: new Date(Math.min(...starts.map(Number))),
				endsAt: new Date(Math.max(...ends.map(Number))),
				...venueOf(first.place),
				/*
				 * The listing, not an occurrence's page. Every occurrence has its own `Id`, the first
				 * one changes every week, and the series slug without an id renders no event.
				 */
				sourceUrl: listingUrl(site),
				organizerName: site.organizer,
				weeklyHours: hours.data
			});
			standing += 1;
		}

		const seen = new Set<string>();
		for (const o of appointments.sort((a, b) => a.date.localeCompare(b.date))) {
			/*
			 * Keyed on the day, never the start instant: a corrected time then updates the row in
			 * place instead of inserting a second one and abandoning the first (CLAUDE.md, "A
			 * source's stated offset is not evidence"). Two occurrences of one series on one day
			 * keep the first; the page has never shown that.
			 */
			const externalId = `${key}@${o.date}`;
			if (seen.has(externalId)) continue;
			seen.add(externalId);
			const startsAt = instant(o.date, o.from, site.timezone);
			const endsAt = o.to ? instant(o.date, o.to, site.timezone) : null;
			rows.push({
				externalId,
				title: o.title,
				category: CATEGORY,
				startsAt,
				endsAt: endsAt && endsAt > startsAt ? endsAt : null,
				...venueOf(o.place),
				sourceUrl: sourceUrlOf(site, o.href),
				organizerName: site.organizer,
				weeklyHours: null
			});
			dated += 1;
		}
	}

	return { rows, failures, occurrences, standing, dated };
}
