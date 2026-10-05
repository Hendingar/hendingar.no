import {
	addDays,
	isCalendarDate,
	MONTH_NAMES,
	zonedWallClockToInstant
} from '@hendingar/core/datetime';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import { plainText } from '@hendingar/core/text';
import type { ListingItem, UpstreamEntry } from './api.ts';
import { entryUrl, SITE } from './site.ts';

/**
 * Pure mapping: a listed entry, and its page when we could read it → our shape. No I/O, no clock,
 * no randomness.
 */

/**
 * Everything imports as `anna`.
 *
 * The same call `importers/mec` makes, for the same reason. Each entry carries Sitevision's
 * `nkm-categories-list` app — the "LOS Kategoriliste" — and on every entry it renders empty: the
 * kommune files no category at all. The calendar is a kommune's "what is on", which holds a
 * handicraft café and a youth holiday programme side by side, so there is no honest default either.
 * Reading a category off the title would be inventing a fact the source never stated; that
 * judgement belongs to the verification service (ADR 0004, ADR 0008).
 */
export const DEFAULT_CATEGORY: CategorySlug = 'anna';

export function slugifyVenue(name: string): string {
	return name
		.toLowerCase()
		.replace(/æ/g, 'ae')
		.replace(/ø/g, 'oe')
		.replace(/å/g, 'aa')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 120);
}

export type MappedEvent = {
	externalId: string;
	title: string;
	category: CategorySlug;
	startsAt: Date;
	endsAt: Date | null;
	venueName: string | null;
	venueSlug: string | null;
	description: string | null;
	posterUrl: string | null;
	posterSrcset: string | null;
	posterRightsVerified: boolean;
	sourceUrl: string;
};

export type MapFailure = { externalId: string; title: string; problem: string };

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}

/**
 * One entry's identity: the Sitevision page, and the day it is on.
 *
 * **The page id, not the slug.** The slug is built from the title and the day the article was
 * written — `2026-08-07-fitjar-husflidslags-handarbeidskafe` — so an editor fixing a typo in the
 * heading changes it, and the older entries are not addressed by a slug at all
 * (`…/fitjarhusflidslagshandarbeidskafe.5.1a2db2a419ed4320d6e1ec97.html`). The `5.<hex>` id is
 * what both URL shapes share, and the only thing on the page that does not move.
 *
 * **The day, not the instant**, for the reason `importers/mec` learned the expensive way: keyed on
 * the start instant, correcting a time inserts a second row and abandons the first — still
 * published, still wrong, and beyond the reach of every later run. Keyed on the day, a re-timed
 * entry updates in place. `localDate` is the date the page states, at the venue, never a UTC date.
 */
export function occurrenceId(pageId: string, localDate: string): string {
	return `${pageId}@${localDate}`;
}

/**
 * What a date line says, as wall clocks at the venue.
 *
 * `startTime` null means the page states no time at all — which is not the same thing as midnight,
 * and `mapEvent` is where that difference is handled.
 */
export type DateLine = {
	startDate: string;
	startTime: string | null;
	endDate: string | null;
	endTime: string | null;
};

type Part = { day: number | null; month: number | null; year: number | null; time: string | null };

/*
 * One side of a range: `24. november 2026, 18.00`, `8. oktober 2026`, `6.`, or a bare `20.00`.
 *
 * The day is a number followed by a full stop and then a space or the end — `(?=\s|$)` — which is
 * what tells `6.` (a day) from `18.00` (a time) when both start with digits and a stop.
 */
const PART =
	/^(?:(\d{1,2})\.(?=\s|$)(?:\s+([a-zæøå]+))?(?:\s+(\d{4}))?)?(?:(?:,\s*|\s+)?(?:kl\.?\s*)?(\d{1,2})[.:](\d{2}))?$/;

function readPart(raw: string): Part | null {
	const value = raw.trim().toLowerCase();
	if (!value) return null;
	const match = PART.exec(value);
	if (!match) return null;
	const [, day, monthName, year, hour, minute] = match;

	let month: number | null = null;
	if (monthName) {
		const index = MONTH_NAMES.findIndex((name) => name === monthName);
		if (index === -1) return null;
		month = index + 1;
	}

	let time: string | null = null;
	if (hour !== undefined && minute !== undefined) {
		const h = Number(hour);
		const m = Number(minute);
		if (h > 23 || m > 59) return null;
		time = `${String(h).padStart(2, '0')}:${minute}`;
	}

	return {
		day: day === undefined ? null : Number(day),
		month,
		year: year === undefined ? null : Number(year),
		time
	};
}

function isoDate(year: number, month: number, day: number): string | null {
	const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	return isCalendarDate(value) ? value : null;
}

/**
 * The `nkm-event-date` line → wall clocks, or null for anything this grammar does not know.
 *
 * Two forms are live on the calendar today: `24. november 2026, 18.00` and `6.–8. oktober 2026`.
 * The grammar is one date or a range of two, each side a Norwegian date with an optional clock, and
 * a range side may leave out what the other side states — `6.–8. oktober 2026` borrows the month
 * and year, `18.00–20.00` borrows the day. That covers the forms a date line is written in without
 * guessing at any of them.
 *
 * Null is the answer for everything else, and that includes one form that does parse: a range
 * whose only clock is on its far side (`6.–8. oktober 2026, 18.00`). Whether that is a start every
 * evening or the time the last day ends is not on the page, and choosing would put a time on an
 * event that nobody gave it. A null becomes a rejection the run reports by name.
 */
export function parseDateLine(text: string): DateLine | null {
	const parts = text
		.replace(/\s+/g, ' ')
		.trim()
		.split(/\s*[–—-]\s*/);
	if (parts.length > 2) return null;

	const left = readPart(parts[0] ?? '');
	if (!left) return null;

	if (parts.length === 1) {
		if (left.day === null || left.month === null || left.year === null) return null;
		const startDate = isoDate(left.year, left.month, left.day);
		return startDate ? { startDate, startTime: left.time, endDate: null, endTime: null } : null;
	}

	const right = readPart(parts[1] ?? '');
	if (!right) return null;

	// `24. november 2026, 18.00–20.00`: the far side is a clock on the same day.
	if (right.day === null) {
		if (left.day === null || left.month === null || left.year === null) return null;
		if (left.time === null || right.time === null) return null;
		const startDate = isoDate(left.year, left.month, left.day);
		return startDate
			? { startDate, startTime: left.time, endDate: null, endTime: right.time }
			: null;
	}

	if (right.month === null || right.year === null || left.day === null) return null;
	// A clock on the far side alone: see above. Not ours to resolve.
	if (left.time === null && right.time !== null) return null;

	const endDate = isoDate(right.year, right.month, right.day);
	if (!endDate) return null;

	const month = left.month ?? right.month;
	let year = left.year ?? right.year;
	/*
	 * `30. desember – 2. januar 2027` states one year, and it is the far side's: a near side that
	 * names its own, later month is in the year before. Only then — `8.–6. oktober 2026` borrows
	 * the month as well, and is simply backwards.
	 */
	if (left.year === null && left.month !== null && left.month > right.month) year -= 1;
	const startDate = isoDate(year, month, left.day);
	if (!startDate || startDate > endDate) return null;

	return { startDate, startTime: left.time, endDate, endTime: right.time };
}

/** Local 23:59:59 — the last second of a day at the venue. */
function endOfDay(localDate: string, timeZone: string): Date {
	return new Date(zonedWallClockToInstant(localDate, '23:59', timeZone).getTime() + 59_000);
}

/**
 * A date line's wall clocks → instants.
 *
 * **A day with no time is stored as local 00:00 to local 23:59:59**, the encoding
 * `importers/bakhagen` settled on and argues for at length: inventing a plausible hour would
 * mis-inform people deciding when to turn up, rejecting the entry would lose a real event over a
 * detail the source was explicit about, and that span is an unambiguous, recoverable "all day"
 * that a display change can read back. A span of days ends at the last second of its last day, so
 * the haustferie programme is still listed on its third day rather than vanishing at midnight
 * before it.
 *
 * **A clock is resolved against the venue's zone, never an offset** — there is no offset anywhere
 * on this site to be wrong, and `zonedWallClockToInstant` is the one function that turns a wall
 * clock into an instant correctly on both sides of a DST change.
 *
 * **An end that is not after the start is dropped.** A same-day `22.00–01.00` is read as running
 * past midnight, because that is the only way it can be an end at all.
 */
export function toInstants(
	line: DateLine,
	timeZone: string
): { startsAt: Date; endsAt: Date | null } {
	const startsAt = zonedWallClockToInstant(line.startDate, line.startTime ?? '00:00', timeZone);

	let endsAt: Date | null = null;
	if (line.endTime !== null) {
		const day = line.endDate ?? line.startDate;
		endsAt = zonedWallClockToInstant(day, line.endTime, timeZone);
		if (line.endDate === null && endsAt.getTime() <= startsAt.getTime()) {
			endsAt = zonedWallClockToInstant(addDays(day, 1), line.endTime, timeZone);
		}
	} else if (line.startTime === null || line.endDate !== null) {
		endsAt = endOfDay(line.endDate ?? line.startDate, timeZone);
	}

	return { startsAt, endsAt: endsAt && endsAt.getTime() > startsAt.getTime() ? endsAt : null };
}

/**
 * The place, from the `Stad:` line the kommune writes into the ingress.
 *
 * There is no location field anywhere — not in the list app's state, not on the entry. `Stad:` is
 * the line written for a human, and the same convention `importers/bomlonr` reads for the same
 * reason.
 *
 * **Read from the entry page, not the listing.** The ingress is `Stad: Fitjar<span>tun 2.
 * høgda.</span>`: a reader sees "Fitjartun", and the list app's plain-text copy of the same ingress
 * puts a space at the tag boundary and says "Fitjar tun". `plainText` joins inline markup the way a
 * browser renders it.
 *
 * **A floor is not part of the place.** "2. høgda" is where in Fitjartun the café is, and a venue
 * slugged `fitjartun-2-hogda` would never match the Fitjartun another calendar names — which is
 * exactly what `pnpm consolidate` needs to happen. The floor is not lost: the ingress it came from
 * is the description.
 */
export function venueFrom(...texts: ReadonlyArray<string | null | undefined>): string | null {
	for (const text of texts) {
		if (!text) continue;
		const line = /(?:^|\n)\s*Stad:\s*([^\n]+)/i.exec(text)?.[1];
		if (!line) continue;
		const place = line
			.trim()
			.replace(/\.$/, '')
			.replace(/[,\s]+\d{1,2}\.\s*(?:høgd[ae]?|etasje|etg\.?)$/i, '')
			.trim();
		// A whole paragraph is not a place name: the line is meant to be short, and anything longer
		// is prose that happened to start with the word.
		if (place && place.length <= 80) return place;
	}
	return null;
}

/** A site path or absolute URL → an absolute URL on the kommune's own host, or null. */
function onSite(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(value, SITE.origin);
		return url.origin === SITE.origin ? url.toString() : null;
	} catch {
		return null;
	}
}

/**
 * Sitevision's srcset, with every candidate made absolute.
 *
 * The page writes `/images/18.…/x160p/Handarbeidskafe.png 160w, …` — site-relative, which works on
 * the kommune's page and nowhere else. Any candidate that will not resolve drops the whole set,
 * because a srcset with a hole in it is worse than the single `src` beside it.
 */
export function absoluteSrcset(srcset: string | null | undefined): string | null {
	if (!srcset) return null;
	const candidates: string[] = [];
	for (const candidate of srcset.split(',')) {
		const [path, width] = candidate.trim().split(/\s+/);
		const url = onSite(path);
		if (!url || !width || !/^\d+w$/.test(width)) return null;
		candidates.push(`${url} ${width}`);
	}
	return candidates.length ? candidates.join(', ') : null;
}

/**
 * One listed entry → our shape, or the reason it cannot be.
 *
 * `entry` is the entry's own page, or null when it could not be read. Every field prefers the page,
 * because it is what a reader decides from; the list app's copy is the fallback, so a page that
 * fails to load costs the place and the full-size poster rather than the event.
 */
export function mapEvent(item: ListingItem, entry: UpstreamEntry | null): MappedEvent | MapFailure {
	const title = entry?.title || plainText(item.articleName) || '';
	if (!title) return { externalId: item.id, title: '', problem: 'empty title' };

	const dateText = entry?.dateText || item.eventDate?.trim() || null;
	if (!dateText) return { externalId: item.id, title, problem: 'no date on the entry or the card' };

	const line = parseDateLine(dateText);
	if (!line) return { externalId: item.id, title, problem: `unreadable date line: ${dateText}` };

	const { startsAt, endsAt } = toInstants(line, SITE.timezone);
	if (Number.isNaN(startsAt.getTime())) {
		return { externalId: item.id, title, problem: `unresolvable start: ${dateText}` };
	}

	/*
	 * The entry page only. The list app's `text` is the same ingress flattened by Sitevision, which
	 * puts a space at every tag boundary — "Fitjar tun" for the "Fitjartun" a reader sees — and a
	 * place name with a stray space is a second venue row, not the same one.
	 */
	const venueName = venueFrom(entry?.preamble, entry?.body);

	/*
	 * The ingress and the body, as the page has them. The ingress is often only the `Stad:` line,
	 * and it is kept anyway: it is the kommune's own text, and it carries the floor `venueFrom`
	 * leaves out of the place name.
	 */
	const description =
		[entry?.preamble ?? plainText(item.text), entry?.body].filter(Boolean).join('\n\n') || null;

	/*
	 * Hotlinked from the kommune's own image store, never copied. The page states nothing about
	 * rights to the poster, and an unstated right is not a granted one — so it is shown where we
	 * link to the source, and kept off anything we generate ourselves (the OG image).
	 */
	const posterUrl = onSite(entry?.image?.src) ?? onSite(item.img);
	const posterSrcset = entry?.image?.src ? absoluteSrcset(entry.image.srcset) : null;

	return {
		externalId: occurrenceId(item.id, line.startDate),
		title,
		category: DEFAULT_CATEGORY,
		startsAt,
		endsAt,
		venueName,
		venueSlug: venueName ? slugifyVenue(venueName) : null,
		description,
		posterUrl,
		posterSrcset,
		posterRightsVerified: false,
		sourceUrl: entryUrl(item.URI)
	};
}

/**
 * Whether the card and the entry print the same date line.
 *
 * Both are rendered by the kommune's NKM apps from one stored value, so they should never differ —
 * and the run says so out loud on the day they do, because then one of the two is reading
 * something we are not.
 */
export function sameDateLine(a: string | null | undefined, b: string | null | undefined): boolean {
	const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
	return norm(a) === norm(b);
}
