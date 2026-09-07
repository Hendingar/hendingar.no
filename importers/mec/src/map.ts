import {
	addDays,
	instantToZonedWallClock,
	zonedWallClockToInstant
} from '@hendingar/core/datetime';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import { plainText } from '@hendingar/core/text';
import type { CardTimes, UpstreamEvent } from './api.ts';
import type { MecInstance } from './instances.ts';

/**
 * Pure mapping: MEC's page → our shape. No I/O, no clock, no randomness.
 */

/**
 * Everything imports as `anna`.
 *
 * This is deliberate, not laziness. MEC has an `mec_category` taxonomy, but on the sites we read
 * it does not hold categories: Bømlo folkebibliotek uses it for audience (Barn / Ungdom / Vaksne)
 * and none of its hundred events carries a term at all, while Moster Amfi uses it for month names.
 * Mapping either onto our taxonomy would be inventing a fact the source never stated.
 *
 * Categorisation is a judgement call, and this repo already has a place for those: the
 * verification service, working on structured data with a human reviewing anything uncertain
 * (ADR 0004, ADR 0008). An importer's job is to be right, not to guess.
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
	ctaUrl: string | null;
	posterUrl: string | null;
	posterRightsVerified: boolean;
	sourceUrl: string;
};

export type MapFailure = { externalId: string; title: string; problem: string };

function safeUrl(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const u = new URL(value);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
	} catch {
		return null;
	}
}

/**
 * One occurrence's identity: the post, and the day it runs on.
 *
 * MEC gives every occurrence of a repeating event the same post id and the same URL — twelve
 * events on one page came from five posts. Keying on the post alone would collapse a weekly chess
 * night into a single row that moves every day; keying on the URL alone has the same problem.
 *
 * **The day, not the instant.** This used to key on `startsAt.toISOString()`, and that is the
 * mistake that turned a wrong clock into a permanent one: correcting a time changes the instant,
 * which changes the id, which inserts a second row and abandons the first — still published, still
 * wrong, and now unreachable by any later run. A venue moving its chess night from 18:00 to 19:00
 * did the same thing. Keyed on the day, a re-timed occurrence *updates*, which is both the
 * behaviour a reader wants and the only version of this that can heal itself.
 *
 * One occurrence per post per day is exactly MEC's own repeat model, so the day loses no identity
 * we had. `localDate` is the date at the venue, never a UTC date — a 20:00 concert is on the day
 * the poster says it is, and `toISOString().slice(0, 10)` would move the late ones.
 */
export function occurrenceId(postId: string, localDate: string): string {
	return `${postId}@${localDate}`;
}

/**
 * An id written by the version of `occurrenceId` that keyed on the instant: `<post>@<ISO instant>`.
 *
 * Lives here, next to the format it is about, and is pure so it can be tested — `ingest.ts` uses it
 * to clear the rows that key left behind, and an over-eager predicate there deletes real events.
 * The `T` is what separates the two formats: a day is `16190@2026-09-07`, an instant
 * `16190@2026-09-07T16:00:00.000Z`.
 */
export function isSupersededOccurrenceId(externalId: string): boolean {
	return /^\d+@\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(externalId);
}

/** A wall clock at the venue: the date it falls on, and the time if the page states one. */
type Stamp = { date: string; time: string | null };

/** MEC's all-day form: a bare `2026-09-08`, with no time and no offset. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A MEC `startDate`/`endDate` → the wall clock at the venue that it actually denotes.
 *
 * **MEC's JSON-LD offset is applied twice, so the instant it spells is not the instant it means.**
 * This is the whole reason this importer reads the rendered page as well as its structured data,
 * and it was live for months: Bømlo folkebibliotek's Pokémontreff is a 16:00 event — the card
 * prints `16:00`, the description says "Kl. 16-17 kvar måndag" — and the JSON-LD for it says
 * `2026-09-07T18:00:00+02:00`, i.e. 16:00 UTC. Every one of the twelve occurrences on that page is
 * out by exactly the Oslo offset, in the same direction. The site's stored wall clock is 16:00; MEC
 * adds the offset to reach 18:00 and then *also* writes the offset it just added.
 *
 * Which means the useful reading is the instant's **UTC wall clock**: strip the offset MEC applied
 * and 18:00+02:00 hands back the 16:00 the venue typed. That is then resolved in the venue's IANA
 * zone rather than against the offset in the string, because an offset is a fact about one moment
 * and a zone is a fact about a place — only the second is still right after the clocks change.
 * `importers/allevents` reads a bogus epoch the same way for the same reason, and its note is the
 * longer version of this one.
 *
 * A date-only value comes back with `time: null`. MEC writes that form for its all-day events, and
 * on two of the three sites here it writes it for *every* event — the clock lives only on the card
 * there, which is what the caller supplies from `CardTimes`.
 */
function readStamp(raw: string): Stamp | null {
	const value = raw.trim();
	if (DATE_ONLY.test(value)) {
		// `2026-02-31` matches the shape and is not a day. Round-tripping catches it.
		const probe = new Date(`${value}T12:00:00Z`);
		if (Number.isNaN(probe.getTime())) return null;
		return probe.toISOString().slice(0, 10) === value ? { date: value, time: null } : null;
	}

	const instant = new Date(value);
	if (Number.isNaN(instant.getTime())) return null;
	return instantToZonedWallClock(instant, 'UTC');
}

/**
 * A wall clock at the venue → the instant it denotes.
 *
 * Never `new Date()`: that resolves a naive wall clock in whichever zone the ingest runner happens
 * to be in, which is UTC in CI and Oslo on a laptop — a bug that only appears in production.
 */
function toInstant(stamp: Stamp, time: string, timeZone: string): Date | null {
	try {
		const instant = zonedWallClockToInstant(stamp.date, time, timeZone);
		return Number.isNaN(instant.getTime()) ? null : instant;
	} catch {
		return null;
	}
}

/**
 * When the occurrence ends, or null when the page does not say.
 *
 * The end is read exactly like the start — card first, corrected JSON-LD clock second — with two
 * rules on top.
 *
 * **An end that is not after the start is dropped rather than stored.** That one rule does the work
 * of three. MEC repeats the start date as the end date for its all-day events, and an `ends_at`
 * equal to `starts_at` is worse than absent — `buildIcal` would emit a DTEND saying the event is
 * over as it begins. It also lets an unstated end fall back to midnight on the end date without
 * inventing anything: on a single-day event that midnight is not after the start, so it goes, while
 * a genuinely multi-day span survives as the multi-day span the source stated.
 *
 * **A card end earlier than its start means the night ran past midnight.** Moster Amfi states its
 * dates date-only, so a card reading `22:00 - 01:00` carries no hint that the 01:00 belongs to the
 * following day, and reading it literally would produce a concert that ends twenty-one hours
 * before it starts. Only applied where the JSON-LD gave no clock of its own — where it did, its
 * end date already rolled over.
 */
function readEnd(
	raw: string,
	card: CardTimes | null,
	startsAt: Date,
	timeZone: string
): Date | null {
	const end = readStamp(raw);
	if (!end) return null;

	const time = card?.end ?? end.time ?? '00:00';

	let instant = toInstant(end, time, timeZone);
	if (instant && card?.end && end.time === null && instant.getTime() <= startsAt.getTime()) {
		instant = toInstant({ date: addDays(end.date, 1), time }, time, timeZone);
	}
	return instant && instant.getTime() > startsAt.getTime() ? instant : null;
}

/**
 * One occurrence → our shape, or the reason it cannot be.
 *
 * `card` is the clock the page prints for this occurrence, paired in `parseListing`. It is the
 * authority on the time, ahead of the JSON-LD: it is what MEC renders from its own stored value,
 * in the site's own zone, and it is what a person reading that page will turn up for. The JSON-LD
 * clock is the fallback, corrected as `readStamp` describes.
 */
export function mapEvent(
	input: UpstreamEvent,
	postId: string | null,
	card: CardTimes | null,
	instance: MecInstance
): MappedEvent | MapFailure {
	/*
	 * Decoded, not merely trimmed.
	 *
	 * `input.name` comes out of the page's JSON-LD, where the site's own text is entity-encoded, and
	 * this importer did no decoding at all — so Moster Amfi's concert was stored, displayed and
	 * published as `Viser, Historie og Humor &laquo;Frå Vestlandet til Amerika i 200 år&raquo;`.
	 * `importers/kyrkja` shipped the same class of bug on twenty-eight events with `B&#248;mlo`,
	 * and `importers/tec` already runs its titles through the same pass.
	 *
	 * The identity below keys on the post id and the day, never the title (see `occurrenceId`), so
	 * correcting a title updates the row in place instead of abandoning it — and the slug is
	 * decoration over an authoritative id (`packages/core/src/slug.ts`), so the URL changing costs
	 * no redirect.
	 */
	const title = plainText(input.name) ?? '';
	const start = readStamp(input.startDate);

	if (!start) {
		return {
			externalId: postId ?? title,
			title,
			problem: `unparseable startDate: ${input.startDate}`
		};
	}
	if (!title) {
		return { externalId: postId ?? '', title: '', problem: 'empty title' };
	}
	/*
	 * Without a post id there is no stable identity, and inventing one from the title would
	 * duplicate the event the first time someone fixes a typo upstream. Rejecting is the honest
	 * outcome, and the run reports it rather than silently dropping the row.
	 */
	if (!postId) {
		return { externalId: title, title, problem: 'no data-event-id found for this event URL' };
	}

	/*
	 * No clock on the card and none in the JSON-LD leaves local midnight, which is MEC's all-day
	 * form and is what Sunnhordland museum's permanent escape room really is.
	 *
	 * Midnight *at the venue*, not midnight UTC — the old reading put every all-day event at 02:00
	 * on a summer morning. It under-informs where a time is genuinely unknown, which is the trade
	 * `importers/bakhagen` records at length for the same case: the day is the part that decides
	 * whether you can go, and inventing a plausible hour would mis-inform instead.
	 */
	const startsAt = toInstant(start, card?.start ?? start.time ?? '00:00', instance.timezone);
	if (!startsAt) {
		return { externalId: postId, title, problem: `unresolvable start: ${input.startDate}` };
	}

	const endsAt = input.endDate ? readEnd(input.endDate, card, startsAt, instance.timezone) : null;

	// The venue's own date for this occurrence, which is what identifies it. Read back out rather
	// than taken from `start.date`, so it is the day the stored instant really lands on.
	const localDate = instantToZonedWallClock(startsAt, instance.timezone).date;

	// Single-venue sites leave `location.name` empty because every event is held in the same place.
	const rawVenue = input.location?.name?.trim() || null;
	const venueName = rawVenue || instance.venueFallback;

	const sourceUrl = safeUrl(input.url) ?? instance.url;

	return {
		externalId: occurrenceId(postId, localDate),
		title,
		category: DEFAULT_CATEGORY,
		startsAt,
		endsAt,
		venueName,
		venueSlug: slugifyVenue(venueName),
		description: input.description?.trim() || null,
		ctaUrl: safeUrl(input.offers?.url),
		/*
		 * Hotlinked from the site's own media library, never copied onto our infrastructure.
		 *
		 * MEC itself states nothing about image rights, so this cannot be read from the page — it
		 * comes from the instance config, which records whether that particular venue has agreed.
		 * An unstated right is still not a granted one; a stated one is.
		 */
		posterUrl: safeUrl(input.image),
		posterRightsVerified: instance.posterRightsCleared,
		sourceUrl
	};
}

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}
