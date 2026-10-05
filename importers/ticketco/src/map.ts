import { instantToZonedWallClock, zonedWallClockToInstant } from '@hendingar/core/datetime';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import { plainText } from '@hendingar/core/text';
import type { CardTime, UpstreamEvent } from './api.ts';
import { eventUrl, type TicketcoShop } from './instances.ts';

/**
 * Pure mapping: one TicketCo listing entry → our shape. No I/O, no clock, no randomness.
 */

/**
 * Everything imports as `anna`.
 *
 * TicketCo's JSON-LD carries no category, no genre and no keywords, and the card carries none
 * either. Most of Frugård's programme is concerts, but "most" is a fact about this month: the same
 * nine events include an Erlend Loe reading and a stand-up show, and reading `musikk` into either
 * would be us deciding, not the source saying. Same reasoning as `importers/mec`: categorisation
 * belongs to the verification service, on structured data, with a human on anything uncertain
 * (ADR 0004, ADR 0008). `anna` is an answer the verifier accepts, not a gap.
 */
export const DEFAULT_CATEGORY: CategorySlug = 'anna';

export function slugifyVenue(name: string): string {
	return name
		.toLowerCase()
		.replace(/æ/g, 'ae')
		.replace(/ø/g, 'oe')
		.replace(/å/g, 'aa')
		.normalize('NFD')
		.replace(/\p{Mn}/gu, '')
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
	description: string | null;
	ctaUrl: string | null;
	posterUrl: string | null;
	posterRightsVerified: boolean;
	sourceUrl: string;
	/**
	 * Where the JSON-LD and the printed card disagreed about the start, as a note for the run.
	 * Null when they agree, which is every event measured — but if TicketCo ever fixes its
	 * offset, this is how the run will say so rather than quietly shifting every event.
	 */
	clockDisagreement: string | null;
};

export type MapFailure = { externalId: string; title: string; problem: string };

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}

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
 * One event's identity: its slug in the shop, and the day it runs on.
 *
 * **The day, not the instant.** CLAUDE.md: correcting a time must update a row, never fork it, and
 * keying on the instant makes every correction a second row with the first abandoned — still
 * published, still wrong. `importers/mec` carries that story in full.
 *
 * The day and not the bare slug, because the slug is the organiser's own text and nothing
 * promises it is unique across years: `ei_jazzy_jul_med_vener_2026` and `rammsund_2026` say the
 * year in the slug, which reads like the organiser making it unique by hand, and the next one who
 * does not would collide with last year's row. `localDate` is the date at the venue, never a UTC
 * date.
 */
export function eventId(slug: string, localDate: string): string {
	return `${slug}@${localDate}`;
}

/** A wall clock at the venue: the date it falls on and the time. */
type WallClock = { date: string; time: string };

const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;

/**
 * A TicketCo `startDate`/`endDate` → the wall clock it denotes, **ignoring the offset it states**.
 *
 * **The `Z` is a lie.** `2026-10-23T18:30:00Z` reads as 18:30 UTC, which is 20:30 in Stord, and it
 * means 18:30 in Stord. Three independent statements from the source agree on that, and none of
 * them is the JSON-LD:
 *
 *   - the listing card prints `23.10.2026 18:30`;
 *   - the event's own page prints "fredag 23 okt 2026 18:30";
 *   - TicketCo's own `.ics` for the event (`/no/nb/events/1080734.ics`, committed as a fixture)
 *     says `DTSTART;TZID=Europe/Oslo:20261023T183000`.
 *
 * And it is not an offset that happens to be right in one season: SLOMOSA on 8 January, in
 * winter time, is `2027-01-08T20:00:00Z` in the JSON-LD, 20:00 on the card and
 * `DTSTART;TZID=Europe/Oslo:20270108T200000` in its `.ics`. The descriptions corroborate the
 * evening hours on their own — RAMMSUND's "Dørene opnar kl 20" sits beside a `20:00:00Z` start.
 * TicketCo is writing the shop's local wall clock and appending `Z`, every time.
 *
 * So the digits are read and the offset is thrown away, and the wall clock is resolved against
 * the shop's IANA zone with `zonedWallClockToInstant` — an offset is a fact about one moment, a
 * zone is a fact about a place, and only the second is still true after the clocks change. This
 * is a different repair from MEC's, which reads the instant's UTC clock because MEC applies its
 * offset twice; here the literal digits are the wall clock, and they would stay right even if
 * TicketCo started writing a true `+02:00` beside them.
 */
export function readWallClock(raw: string): WallClock | null {
	const match = STAMP.exec(raw.trim());
	if (!match) return null;
	const [, date, hourRaw, minute] = match;
	if (!date) return null;
	if (Number(hourRaw) > 23 || Number(minute) > 59) return null;
	const probe = new Date(`${date}T12:00:00Z`);
	if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== date) return null;
	return { date, time: `${hourRaw}:${minute}` };
}

/**
 * A wall clock at the venue → the instant it denotes. Never `new Date()` on a naive string: that
 * resolves it in whichever zone the runner happens to be in, UTC in CI and Oslo on a laptop.
 */
function toInstant(clock: WallClock, timeZone: string): Date | null {
	try {
		const instant = zonedWallClockToInstant(clock.date, clock.time, timeZone);
		return Number.isNaN(instant.getTime()) ? null : instant;
	} catch {
		return null;
	}
}

/**
 * Is this event still happening?
 *
 * Only a cancellation disqualifies one. A sold-out show is still on, and the JSON-LD says nothing
 * about tickets anyway. schema.org allows the status as a bare name or as a full
 * `https://schema.org/EventCancelled`, so both are read.
 */
export function isCancelled(event: UpstreamEvent): boolean {
	return /(^|\/)EventCancelled$/.test(event.eventStatus?.trim() ?? '');
}

/**
 * One event → our shape, or the reason it cannot be.
 *
 * `card` is the date and clock the listing prints for this event. It is the authority on the
 * start, ahead of the JSON-LD: it is what a person reading the shop will turn up for. The JSON-LD
 * clock, read as `readWallClock` describes, is the fallback — and on every event measured the two
 * agree to the minute.
 */
export function mapEvent(
	input: UpstreamEvent,
	slug: string | null,
	card: CardTime | null,
	shop: TicketcoShop
): MappedEvent | MapFailure {
	// Decoded and trimmed: names arrive with trailing spaces ("RAMMSUND ") and may carry entities.
	const title = plainText(input.name) ?? '';
	if (!title) return { externalId: slug ?? '', title: '', problem: 'empty title' };
	/*
	 * Without a slug there is no stable identity, and inventing one from the title would duplicate
	 * the event the first time somebody fixes a typo upstream. Rejected, and the run reports it.
	 */
	if (!slug) return { externalId: title, title, problem: `no /e/<slug> in url: ${input.url}` };

	const stated = readWallClock(input.startDate);
	const start = card ?? stated;
	if (!start) {
		return { externalId: slug, title, problem: `unparseable startDate: ${input.startDate}` };
	}
	const startsAt = toInstant(start, shop.timezone);
	if (!startsAt)
		return { externalId: slug, title, problem: `unresolvable start: ${input.startDate}` };

	const clockDisagreement =
		card && stated && (card.date !== stated.date || card.time !== stated.time)
			? `card prints ${card.date} ${card.time}, JSON-LD says ${input.startDate}`
			: null;

	/*
	 * The end comes from the JSON-LD alone — the card prints none — read the same way as the start.
	 * An end that is not after the start is dropped rather than stored: it would render as an
	 * event that is over as it begins.
	 */
	const endClock = input.endDate ? readWallClock(input.endDate) : null;
	const endInstant = endClock ? toInstant(endClock, shop.timezone) : null;
	const endsAt = endInstant && endInstant.getTime() > startsAt.getTime() ? endInstant : null;

	// Read back out of the stored instant, so the id names the day the event really lands on.
	const localDate = instantToZonedWallClock(startsAt, shop.timezone).date;

	return {
		externalId: eventId(slug, localDate),
		title,
		category: DEFAULT_CATEGORY,
		startsAt,
		endsAt,
		// The organiser's rich-text box, as HTML. `plainText` keeps the paragraphs as blank lines,
		// which matters here: the door time and the show time are separate paragraphs.
		description: plainText(input.description),
		/*
		 * Null, though the event page is also where you buy the ticket — same as `hoopla/map.ts`.
		 * "Read more" and "buy" are one URL on TicketCo, so naming it as both would render two
		 * identical buttons. It is named once, as the source.
		 */
		ctaUrl: null,
		// Hotlinked from TicketCo's own upload bucket, never copied onto our infrastructure.
		posterUrl: safeUrl(input.image),
		posterRightsVerified: shop.posterRightsCleared,
		sourceUrl: eventUrl(shop, slug),
		clockDisagreement
	};
}
