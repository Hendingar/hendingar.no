import { zonedWallClockToInstant } from '@hendingar/core/datetime';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import type { UpstreamDetail, UpstreamEvent } from './api.ts';
import { organiserUrl, type AlleventsOrganiser } from './organisers.ts';
import { fromLine, type ParsedAddress } from '@hendingar/core/address';

/**
 * Pure mapping: one allevents.in record → our shape. No I/O, no clock, no randomness.
 *
 * This is also where the source's known lossiness is answered. allevents.in mirrors Facebook pages
 * through a third party, and the mirror is visibly imperfect — an empty city, `addressRegion: "RO"`
 * for Norway, a description cut mid-word. The tempting response was to import everything as
 * `pending`; it is the wrong one, because nothing promotes a pending *import* (no importer calls the
 * verifier, and ADR 0012 removed the review queue), so every listing filters it out forever while
 * the run reports healthy.
 *
 * So `mapEvent` **refuses** a record it cannot vouch for and says why, and the reason reaches the
 * `ingest_runs` message. A skipped row with a reason is visible; a pending row is not.
 */

/* ------------------------------------------------------------------------------ category ----- */

/**
 * allevents.in's category slugs → our taxonomy, **in our order of specificity, not theirs**.
 *
 * A record carries a list rather than one value, and the list is not ordered usefully: the same
 * jazz concert is `["entertainment", "music"]` on one event and `["festivals", "music",
 * "entertainment"]` on another, both of them an evening at Stord Hotell. Taking the source's first
 * entry would file one under `anna` and the other under `festival`. So the rules are walked in this
 * order and the first one the record carries wins — which is why `music` deliberately sits above
 * `festivals` and `art`: a concert *at* a festival is still a concert, and a festival that is only
 * a festival still says so.
 *
 * `entertainment` is deliberately absent. It is allevents.in's catch-all and rides along on almost
 * every record, so mapping it would swallow every more specific signal.
 *
 * The `tags` array is deliberately unused. It says `"movie"` on a jazz concert and `"Yoga"` on a
 * yoga class — free text with no vocabulary, and guessing from it is exactly what ADR 0004 keeps out
 * of the import path.
 */
const CATEGORY_RULES: ReadonlyArray<{ slugs: readonly string[]; category: CategorySlug }> = [
	{ slugs: ['concerts', 'live-music', 'nightlife-music'], category: 'musikk' },
	{ slugs: ['theatre', 'theater', 'performances'], category: 'teater' },
	{ slugs: ['comedy'], category: 'stand-up' },
	{ slugs: ['dance'], category: 'dans' },
	{ slugs: ['parties', 'nightlife'], category: 'dans' },
	{ slugs: ['exhibitions', 'fine-arts', 'photography'], category: 'utstilling' },
	{ slugs: ['sports'], category: 'sport' },
	{ slugs: ['christian', 'religion'], category: 'kyrkjeliv' },
	{ slugs: ['literary-art', 'poetry', 'books'], category: 'litteratur' },
	{ slugs: ['food-drinks', 'cooking'], category: 'mat-og-drikke' },
	{ slugs: ['workshops', 'crafts', 'health-wellness'], category: 'kurs' },
	{ slugs: ['webinar', 'business'], category: 'konferanse' },
	{ slugs: ['meetups'], category: 'mote' },
	{ slugs: ['music'], category: 'musikk' },
	{ slugs: ['festivals'], category: 'festival' },
	{ slugs: ['art'], category: 'utstilling' }
];

/**
 * The category, or `anna`.
 *
 * `anna` is the honest answer for a record that carries no categories at all, which happens: Sagvåg
 * Bygdalag's "Spøt og Drøs" arrives with `categories: []`. Guessing "mote" from the title would be
 * inventing a fact — the verification service categorises on structured data with a human for the
 * uncertain cases, and that is where a better answer belongs.
 *
 * Case is folded because the source does not: one of the eight jazz events says `["Concerts",
 * "Music", "Entertainment"]` while the other seven are lowercase.
 */
export function mapCategory(categories: readonly string[] | null | undefined): CategorySlug {
	const present = new Set((categories ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean));
	for (const rule of CATEGORY_RULES) {
		if (rule.slugs.some((slug) => present.has(slug))) return rule.category;
	}
	return 'anna';
}

/* -------------------------------------------------------------------------------- locality ---- */

/**
 * The only locality check this importer makes — see the note in `organisers.ts` for why there is no
 * bounding box.
 *
 * `venue.country` is the one part of an allevents.in address that is stated reliably. Its siblings
 * are not: `addressLocality`/`city` is empty on three of our four organisers and flatly wrong on the
 * fourth (Sagvåg Bygdalag's hall in Sagvåg is filed under `"Ølen"`, forty kilometres away), and
 * `addressRegion` says `"RO"` — Romania — for every event in Norway.
 *
 * A missing or empty country is accepted rather than rejected. Losing a real event over a blank
 * field is the worse failure, and it would be silent.
 */
const EXPECTED_COUNTRY = /^(norway|norge|noreg|no)$/i;

export function isInCountry(country: string | null | undefined): boolean {
	const value = country?.trim();
	return !value || EXPECTED_COUNTRY.test(value);
}

/* ----------------------------------------------------------------------------------- venue ---- */

const firstSegment = (value: string) => (value.split(',')[0] ?? '').trim();

/**
 * The venue's name — or the organiser's, when the source gave an address instead of a name.
 *
 * allevents.in mirrors whatever the Facebook page had in its place field, and half the time that is
 * a postal address: Stord Jazzklubb gets `"Stord Kulturhus"`, but Flow Yoga gets
 * `"Hollundsdalen 49, 5430 Bremnes, Norway"` and Gruo Pub gets `"Sagvågsbrekko 6, Stord Island"`.
 *
 * Telling the two apart without guessing at what a street looks like: the record *also* carries
 * `venue.street`, the full postal address. When `location` opens with the same thing the street
 * does, `location` is the address repeated and names no venue at all — so the organiser's own name
 * is used instead. Slugging a venue from a street number would give us `hollundsdalen-49`, which
 * `pnpm consolidate` could never match against the same place named plainly by another source, and
 * which reads as a bug on a card.
 *
 * Everything after the first comma is dropped either way. `venues` has a name, a municipality and
 * coordinates, and no field a trailing address line belongs in — the same conclusion
 * `importers/bakhagen` reached about hagelag that write their whole address into the place name.
 */
export function venueNameFrom(
	location: string | null | undefined,
	street: string | null | undefined,
	fallback: string
): string {
	const name = firstSegment(location ?? '');
	if (name.length < 2) return fallback;
	if (street && firstSegment(street).toLowerCase() === name.toLowerCase()) return fallback;
	return name;
}

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

/* ---------------------------------------------------------------------------------- poster ---- */

/**
 * The card is at most 434 CSS pixels wide and the event page at most 832, so this ladder covers both
 * to 2× without asking a third party's resizer for sizes nobody displays.
 */
const POSTER_WIDTHS = [400, 600, 800, 1200] as const;

export type Poster = { url: string | null; srcset: string | null };

const BANNER =
	/^https:\/\/cdn-ip\.allevents\.in\/s\/(.+)\/([A-Za-z0-9_-]+)\.(avif|webp|jpg|jpeg|png)$/;

/**
 * The event's banner, at sizes we actually display.
 *
 * allevents.in serves banners through an **unsigned** imgproxy: the geometry is path segments
 * (`/s/rs:fill:500:250/g:sm/sh:100/<base64url>.avif`) with no signature to invalidate, so unlike
 * Billetto's imgix we can ask for the sizes we want. Measured: the 500-wide default is 20 KB, the
 * same token at `rs:fit:1200:0` is 128 KB and 1200 px. Their own page only ever asks for the
 * 500×250 crop, which is a third of a card at 2×.
 *
 * Two deliberate choices:
 *
 * - **`rs:fit`, not `rs:fill`.** `fill` crops to a 2:1 letterbox chosen for their grid. These are
 *   posters — a portrait 1200×1799 gig poster for Gruo Pub, a square 1200×1200 for the yoga studio
 *   — and cropping them to 2:1 throws away most of the picture and usually the text on it. `fit`
 *   keeps the whole image and the source's own aspect ratio.
 * - **The ladder is capped at the original width**, which the token spells out once decoded: the
 *   original URL ends `-rimg-w1200-h969-…`. imgproxy will not enlarge, so a `1200w` candidate for
 *   an 800-pixel original would be an 800-pixel image the browser was told is 1200 — a bad srcset
 *   is worse than a short one.
 *
 * A URL that is not one of their imgproxy renditions is left exactly as it is. That includes
 * `dyn-image.allevents.in/generate-image?…`, the title-card placeholder allevents.in synthesises for
 * an event with no picture, which is filtered out entirely by `posterFrom` — we generate our own
 * tiles and would rather show one than someone else's grey rectangle.
 */
export function posterFrom(banner: string | null | undefined): Poster {
	const url = safeUrl(banner);
	if (!url) return { url: null, srcset: null };
	// A synthesised title card, not a poster. See above.
	if (url.startsWith('https://dyn-image.allevents.in/')) return { url: null, srcset: null };

	const match = BANNER.exec(url);
	const token = match?.[2];
	if (!token) return { url, srcset: null };

	const widths = POSTER_WIDTHS.filter((w) => w <= (originalWidth(token) ?? Infinity));
	if (widths.length === 0) return { url, srcset: null };

	const at = (w: number) => `https://cdn-ip.allevents.in/s/rs:fit:${w}:0/g:sm/sh:100/${token}.avif`;
	return {
		url: at(widths[widths.length - 1]!),
		srcset: widths.map((w) => `${at(w)} ${w}w`).join(', ')
	};
}

/**
 * The original's width, read out of the base64url-encoded source URL the imgproxy token *is*.
 *
 * Decoding it is not cleverness for its own sake: it is the only statement anywhere of how large
 * the picture actually is, and without it the srcset would promise widths that do not exist. Any
 * failure to decode returns null and the ladder simply is not capped.
 */
export function originalWidth(token: string): number | null {
	let decoded: string;
	try {
		decoded = Buffer.from(token, 'base64url').toString('utf8');
	} catch {
		return null;
	}
	const width = /-rimg-w(\d{2,5})-/.exec(decoded)?.[1];
	if (!width) return null;
	const parsed = Number.parseInt(width, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/* -------------------------------------------------------------------------------- outbound ---- */

function safeUrl(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const u = new URL(value.trim());
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
		return u.toString();
	} catch {
		return null;
	}
}

/**
 * An allevents.in page URL, normalised.
 *
 * Two things need doing. **Percent-encoding**, because the API returns the path with the organiser's
 * own letters in it — `…/vald-heks-på-gruo-pub-lørdag-19-september/…` raw in one record and
 * `…/%C3%98len/spøt-og-drøs/…` half-encoded in the next. `new URL()` normalises both, and this is
 * the reason nothing here regexes slugs out of the HTML: an ASCII-only pattern finds none of them.
 *
 * And **stripping the query**, because every link on the site carries a `?ref=organizer-new` that
 * `robots.txt` explicitly disallows, and because a tracking parameter is not part of an event's
 * identity — keeping it would make the stored URL churn the day they rename their campaign.
 */
export function cleanEventUrl(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		url.search = '';
		url.hash = '';
		return url.toString();
	} catch {
		return null;
	}
}

/**
 * Hosts we will not send a reader to, however the source labels the link.
 *
 * `ticket_url` is a real box office for a ticketed event (`checkout.ebillett.no` for the jazz club)
 * and the literal string `http://facebook.com/<event id>` for the three organisers whose events are
 * free. Following the second lands a reader on a login wall, and building on Facebook is the
 * dependency this project exists to escape — see the README non-goals and `docs/event-sources.md`.
 * There is no CTA in that case; the allevents.in page is the link, as `sourceUrl`.
 */
const BLOCKED_CTA_HOSTS = /(^|\.)(facebook\.com|fb\.me|fb\.com|instagram\.com|allevents\.in)$/i;

export function ctaFrom(ticketUrl: string | null | undefined): string | null {
	const url = safeUrl(ticketUrl);
	if (!url) return null;
	try {
		return BLOCKED_CTA_HOSTS.test(new URL(url).hostname) ? null : url;
	} catch {
		return null;
	}
}

/* ----------------------------------------------------------------------------- description ---- */

/**
 * Which of two descriptions to keep, given what we already hold and what today's fetch produced.
 *
 * Pure and separate from the database work because the rule is the interesting part and the upsert
 * is not. Two things it protects against, both of them observed rather than imagined:
 *
 * - **A page that 500s.** Two of eight jazz event pages answered 500 on the second run of one
 *   afternoon. Writing `null` over good text would delete it, report the deletion as an `updated`,
 *   and have the next successful run put it back — so the only trace would be a description that
 *   came and went.
 * - **A page that comes back stripped.** allevents.in serves the same URL as a full page and as a
 *   163 KB variant with no description div, at random. The fallback then yields upstream's
 *   250-character stub, which is a *prefix of the same text* — a strictly worse copy of what we
 *   already have. See `UpstreamDetail.truncated`.
 *
 * A complete description always wins, including a shorter one: an organiser who cuts their blurb
 * down should see it cut down here too. It is only the two degraded cases that are refused.
 */
export function preferDescription(
	existing: string | null,
	incoming: string | null,
	source: { failed: boolean; truncated: boolean }
): string | null {
	if (source.failed) return existing;
	if (!source.truncated) return incoming;
	// A truncated stub never replaces something at least as long — that is always a downgrade.
	if (existing && (!incoming || existing.length >= incoming.length)) return existing;
	return incoming;
}

/* ------------------------------------------------------------------------------------ time ---- */

/**
 * Is this number in a range an event calendar could mean?
 *
 * Bounded by two fixed instants, `2000-01-01` and `2100-01-01`, and deliberately not by the clock —
 * a rule that says "not too far from today" would make the tests depend on when they run (CLAUDE.md
 * rule 6), and the ingest is what decides what is upcoming anyway.
 *
 * What this actually catches is a unit mix-up. A `start_time` in **milliseconds** is about
 * 1.79 × 10¹² and lands in the year 58 000; a missing one is `0` and lands in 1970. Both would
 * otherwise be written to `starts_at` as a perfectly valid `timestamptz` that no reader will ever
 * see, and neither would raise anything anywhere.
 */
const SECONDS_FLOOR = Date.UTC(2000, 0, 1) / 1000;
const SECONDS_CEILING = Date.UTC(2100, 0, 1) / 1000;

export function isPlausibleEpochSeconds(value: number): boolean {
	return Number.isFinite(value) && value >= SECONDS_FLOOR && value < SECONDS_CEILING;
}

/**
 * `start_time` → the instant the concert actually starts.
 *
 * **`start_time` is not an epoch, and reading it as one shifts every event by an hour or two.**
 * This is the single most important line in the importer, and it took a failing assertion against
 * the event's own page to catch — the two disagreed by exactly the Oslo offset.
 *
 * What the number really is: the organiser's **local wall clock, serialised as though it were UTC**.
 * Stord Jazzklubb's TID concert has `start_time: 1789844400`, which as an epoch is
 * `2026-09-19T19:00:00Z` — but the same record's `start_time_display` says "Sat, 19 Sep at 07:00 pm"
 * and the event's own page says `"startDate": "2026-09-19T19:00:00+02:00"`, i.e. 17:00Z. Nineteen
 * hundred is the wall clock; the trailing `Z` is an artefact of how they store it. Their own Vue app
 * agrees — it calls `addTimezoneDiff(item.start_time, …, -1)` before displaying.
 *
 * So the number is decomposed back into a wall clock and re-resolved in the venue's **IANA zone**,
 * which is the way round that survives a DST boundary: `zonedWallClockToInstant` knows that
 * 7 November 2026 in Oslo is `+01:00` while 24 October is `+02:00`. (The record's own `timezone`
 * field happens to get this right too — it says `+01:00` for the November and December concerts —
 * but an offset is a fact about one moment and a zone is a fact about a place, and only the second
 * is still correct next year. `importers/fotball` made the same call for the same reason.)
 */
export function wallClockToInstant(seconds: number, timeZone: string): Date | null {
	if (!isPlausibleEpochSeconds(seconds)) return null;
	const asIfUtc = new Date(seconds * 1000);
	const date = asIfUtc.toISOString().slice(0, 10);
	const time = asIfUtc.toISOString().slice(11, 16);
	try {
		const instant = zonedWallClockToInstant(date, time, timeZone);
		return Number.isNaN(instant.getTime()) ? null : instant;
	} catch {
		return null;
	}
}

/**
 * Whether the record's own stated offset agrees with the venue's zone at that wall clock.
 *
 * A cheap cross-check on the assumption above, and the only thing that would notice an event this
 * organiser is holding in another timezone entirely — a summer course in Reykjavík would come back
 * as `+00:00` and be read, wrongly, as Oslo time. Where they disagree the record is refused and
 * says so, rather than being published an hour out.
 *
 * A missing or unparseable `timezone` is accepted: it is a corroboration, not the source of truth,
 * and losing a real event to a blank field is the worse failure.
 */
export function offsetAgrees(
	stated: string | null | undefined,
	instant: Date,
	timeZone: string
): boolean {
	const match = /^([+-])(\d{2}):?(\d{2})$/.exec(stated?.trim() ?? '');
	if (!match) return true;
	const sign = match[1] === '-' ? -1 : 1;
	const statedMinutes = sign * (Number(match[2]) * 60 + Number(match[3]));

	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		timeZoneName: 'longOffset'
	}).formatToParts(instant);
	const zoneName = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
	const zoneMatch = /GMT([+-])(\d{2}):(\d{2})/.exec(zoneName);
	// `GMT` with nothing after it means +00:00.
	const actualMinutes = zoneMatch
		? (zoneMatch[1] === '-' ? -1 : 1) * (Number(zoneMatch[2]) * 60 + Number(zoneMatch[3]))
		: zoneName === 'GMT'
			? 0
			: null;
	if (actualMinutes === null) return true;

	return statedMinutes === actualMinutes;
}

/* ----------------------------------------------------------------------------------- event ---- */

export type MappedEvent = {
	externalId: string;
	title: string;
	category: CategorySlug;
	startsAt: Date;
	endsAt: Date | null;
	venueName: string;
	venueSlug: string;
	/** Parsed out of the single `street` line, when it holds an address at all. */
	venueAddress: ParsedAddress;
	description: string | null;
	ctaUrl: string | null;
	posterUrl: string | null;
	posterSrcset: string | null;
	posterRightsVerified: boolean;
	sourceUrl: string;
};

export type MapFailure = { externalId: string; title: string; problem: string };

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}

export function mapEvent(
	input: UpstreamEvent,
	detail: UpstreamDetail | null,
	organiser: AlleventsOrganiser
): MappedEvent | MapFailure {
	const externalId = String(input.event_id);
	const title = input.eventname.trim().replace(/\s+/g, ' ');

	/*
	 * Three characters, which is `eventSubmissionSchema.title`'s own minimum in packages/core — not a
	 * number picked here. A record whose title did not survive the mirror is not repairable
	 * downstream, so it is refused rather than imported as a stub nobody can identify.
	 */
	if (title.length < 3) return { externalId, title, problem: `unusable title: "${title}"` };

	/*
	 * Publication flags, all three of them, because they mean different things and any one of them
	 * being set means this is not something to put in front of a reader. `spam` and `draft` arrive
	 * as the strings "0"/"1", so they are compared numerically rather than for truthiness — the
	 * string "0" is truthy in JavaScript, and reading it as a boolean would suppress every event.
	 */
	if (input.status && input.status.toUpperCase() !== 'PUBLISHED') {
		return { externalId, title, problem: `not published upstream (${input.status})` };
	}
	if (Number(input.spam ?? 0) !== 0) return { externalId, title, problem: 'flagged as spam' };
	if (Number(input.draft ?? 0) !== 0) return { externalId, title, problem: 'still a draft' };

	if (!isInCountry(input.venue?.country)) {
		return {
			externalId,
			title,
			problem: `outside Norway (${input.venue?.country ?? 'unknown'})`
		};
	}

	/*
	 * The start, read as a wall clock and resolved in the venue's zone. See `wallClockToInstant` —
	 * `start_time` looks exactly like an epoch and is not one, and this is the field most likely to
	 * be got wrong by whoever touches this next.
	 */
	const startsAt = wallClockToInstant(input.start_time, organiser.timezone);
	if (!startsAt) {
		return { externalId, title, problem: `unusable start_time: ${input.start_time}` };
	}
	if (!offsetAgrees(input.timezone, startsAt, organiser.timezone)) {
		return {
			externalId,
			title,
			problem: `stated offset ${input.timezone} is not ${organiser.timezone} at that moment`
		};
	}

	/*
	 * `end_time` repeats `start_time` when the organiser stated no end — it is not null and not
	 * absent, it is the same number again. Storing that would give every jazz concert a zero-length
	 * duration, which reads as a fact ("ends immediately") rather than as the absence of one. Only
	 * an end strictly after the start is an end.
	 */
	let endsAt: Date | null = null;
	if (typeof input.end_time === 'number') {
		const parsed = wallClockToInstant(input.end_time, organiser.timezone);
		if (parsed && parsed.getTime() > startsAt.getTime()) endsAt = parsed;
	}

	const venueName = venueNameFrom(input.location, input.venue?.street, organiser.venueFallback);
	const poster = posterFrom(input.banner_url);

	return {
		externalId,
		title,
		category: mapCategory(input.categories),
		startsAt,
		endsAt,
		venueName,
		venueSlug: slugifyVenue(venueName),
		/*
		 * allevents.in writes the whole address on one line, and inconsistently: sometimes
		 * "Sagvågsbrekko 7, 5410 Sagvåg, Norge", sometimes with the venue's name in front of it.
		 * `fromLine` scans for the segment that looks like a street rather than trusting the first,
		 * and returns nothing at all when none of them does — which is the common case, and is why
		 * `venueNameFrom` above still exists.
		 */
		venueAddress: fromLine(input.venue?.street),
		/*
		 * From the event's own page, when we could read it. It is the one field `get_events` does not
		 * return, and a detail fetch that fails costs a description rather than the event.
		 */
		description: detail?.description ?? null,
		ctaUrl: ctaFrom(input.ticket_url),
		posterUrl: poster.url,
		posterSrcset: poster.srcset,
		/*
		 * Recorded as unverified. The picture belongs to whoever made the Facebook event
		 * allevents.in mirrored, and allevents.in states nothing about reuse — an unstated right is
		 * not a granted one (issue #3).
		 */
		posterRightsVerified: false,
		// The allevents.in event page: openly readable, unlike the Facebook original behind it.
		sourceUrl: cleanEventUrl(input.event_url) ?? organiserUrl(organiser)
	};
}
