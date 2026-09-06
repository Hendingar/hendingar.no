import { zonedWallClockToInstant } from '@hendingar/core/datetime';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import type { UpstreamCategory, UpstreamEvent, UpstreamImage } from './api.ts';
import type { TecInstance } from './instances.ts';
import { fromParts, type ParsedAddress } from '@hendingar/core/address';

/**
 * Pure mapping: a tribe/events/v1 record → our shape. No I/O, no clock, no randomness.
 */

/* -------------------------------------------------------------------------------------------- */
/* Text                                                                                           */
/* -------------------------------------------------------------------------------------------- */

/**
 * The named entities WordPress actually emits. Numeric references are handled generically below.
 *
 * The plugin returns `wp_kses`-escaped titles, so `&#8211;`, `&#8217;` and `&#038;` arrive in the
 * JSON as literal text rather than as characters — the fixture has all three. `importers/kyrkja`
 * learned what skipping this costs: twenty-eight events published with `B&#248;mlo` in the title.
 */
const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	hellip: '…',
	ndash: '–',
	mdash: '—',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”'
};

export function decodeEntities(value: string): string {
	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
		if (body.startsWith('#')) {
			const code =
				body[1] === 'x' || body[1] === 'X'
					? Number.parseInt(body.slice(2), 16)
					: Number.parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: match;
		}
		return NAMED_ENTITIES[body] ?? match;
	});
}

/**
 * Markup out, entities decoded, whitespace collapsed.
 *
 * `description` is the post body as rendered HTML — paragraphs, links, the occasional embed. We
 * store plain text, so the tags are replaced by a space rather than removed, or `<p>a</p><p>b</p>`
 * becomes `ab`.
 */
export function plainText(value: string): string {
	return decodeEntities(value.replace(/<[^>]+>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();
}

/* -------------------------------------------------------------------------------------------- */
/* Time                                                                                           */
/* -------------------------------------------------------------------------------------------- */

/**
 * Which zone an event's wall clocks are really in.
 *
 * The plugin reports a `timezone` per event, and on a correctly configured site it is an IANA name
 * — `America/New_York` in the bikeleague fixture, with `utc_start_date` four or five hours ahead
 * of `start_date` depending on the season. That site is believed.
 *
 * A WordPress set to a **manual UTC offset** instead of a city reports `UTC+0`, `UTC+2` and so on.
 * bomloteater.no is one: `/wp-json/` gives `timezone_string: ""` and `gmt_offset: "0"`, so the
 * plugin labels every event `UTC+0` and copies `start_date` into `utc_start_date` unchanged —
 * `2022-12-08 20:00:00` for both. A 20:00 curtain-up in Bremnes is not 20:00 UTC, so that is a
 * local wall clock wearing the wrong label, and `utc_start_date` is simply false.
 *
 * **Nothing here ever reads `utc_start_date`.** Not as a fallback, not as a cross-check: a value
 * that is right on well-configured sites and silently wrong on the one we import is worse than one
 * we never touch, because the failure would be invisible.
 *
 * A `UTC±N` string is rejected rather than parsed even when it is not zero, because a fixed offset
 * has no DST rule: `UTC+1` would be right in Bømlo in January and an hour out in July. Only a zone
 * name — which must contain a region separator, so `UTC` and `GMT` are out too — carries the rules
 * that make a wall clock convertible. Everything else falls back to the zone the instance config
 * states, which is a fact a human checked.
 */
export function resolveZone(reported: string | null | undefined, fallback: string): string {
	const name = reported?.trim();
	if (!name || !name.includes('/')) return fallback;
	try {
		// Throws RangeError on anything ICU does not know. Pure: no clock is read.
		new Intl.DateTimeFormat('en-US', { timeZone: name });
		return name;
	} catch {
		return fallback;
	}
}

/** `YYYY-MM-DD HH:MM:SS`, the only shape the plugin writes its dates in. */
const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/**
 * A reported wall clock → the instant it denotes in `zone`.
 *
 * `zonedWallClockToInstant` is `packages/core`'s, already tested across DST transitions; this
 * function's whole job is to refuse anything that is not the expected shape, so an unreadable
 * date becomes a reported rejection instead of an `Invalid Date` written to the database.
 *
 * `zonedWallClockToInstant` works to the minute, so the seconds are added afterwards. They are not
 * a detail to round off: a whole-day event is exactly `00:00:00` → `23:59:59`, and that second is
 * half of the marker the encoding relies on (see `mapEvent`). Adding them as milliseconds is safe
 * because no zone has ever changed offset part-way through a minute.
 *
 * Requiring seconds in the pattern is also what makes an ISO string with an offset — which would
 * mean something different — fail to match rather than be quietly mis-read.
 */
export function wallClockToInstant(value: string, zone: string): Date | null {
	const match = WALL_CLOCK.exec(value.trim());
	if (!match) return null;
	const [, date, hour, minute, second] = match;
	if (!date || !hour || !minute) return null;
	const minutePrecision = zonedWallClockToInstant(date, `${hour}:${minute}`, zone);
	if (Number.isNaN(minutePrecision.getTime())) return null;
	return new Date(minutePrecision.getTime() + Number(second ?? 0) * 1000);
}

/**
 * Whether the source is describing a whole day rather than a moment.
 *
 * The plugin says so twice: the `all_day` flag, and structurally as local `00:00:00` →
 * `23:59:59`. Both are read, because either alone has a way of being wrong — a site's editor can
 * type a 00:00–23:59:59 span without ticking the box, and the flag is the only signal on a record
 * whose end date is missing.
 */
export function isAllDay(input: UpstreamEvent): boolean {
	if (input.all_day === true) return true;
	const start = WALL_CLOCK.exec(input.start_date.trim());
	const end = input.end_date ? WALL_CLOCK.exec(input.end_date.trim()) : null;
	if (!start || !end) return false;
	return (
		`${start[2]}:${start[3]}:${start[4]}` === '00:00:00' &&
		`${end[2]}:${end[3]}:${end[4]}` === '23:59:59'
	);
}

/* -------------------------------------------------------------------------------------------- */
/* Categories                                                                                     */
/* -------------------------------------------------------------------------------------------- */

/**
 * The site's own `tribe_events_cat` terms → our taxonomy.
 *
 * Unlike MEC — whose category taxonomy turned out to hold audience labels and month names on the
 * sites we read — The Events Calendar's terms are what they say they are: `webinar`, `summit`,
 * `lci-seminar` on the bikeleague fixture. So they are worth reading, and reading them is a
 * translation rather than a guess.
 *
 * The rules stay where a word means one thing, the same discipline `importers/bakhagen` settled
 * on. "Arrangement", "aktivitet" and "program" are deliberately absent: they are not categories,
 * they are the word for an event, and every one of them lands on the instance default anyway.
 *
 * Nothing here looks at the **title**. A title is free prose and inventing a category from prose is
 * exactly what ADR 0004 keeps out of the import path; the plugin hands us a controlled vocabulary,
 * so we translate that and stop.
 *
 * Order is priority: the first rule that matches any of the event's terms wins, so the result does
 * not depend on which order the API happened to list the terms in.
 *
 * The order is **form before genre**, which is a decision and not an accident. A Norwegian compound
 * is named by its last morpheme, so a `teaterkurs` is a course and a `musikkfestival` is a festival
 * — the thing you turn up to — while the first half only says what it is about. Putting `kurs`,
 * `konferanse`, `festival` and `marknad` above the genres makes the table agree with the language.
 */
const CATEGORY_RULES: ReadonlyArray<{ stems: readonly string[]; category: CategorySlug }> = [
	{ stems: ['standup'], category: 'stand-up' },
	{ stems: ['kurs', 'workshop'], category: 'kurs' },
	{ stems: ['konferanse', 'conference', 'seminar', 'webinar'], category: 'konferanse' },
	{ stems: ['festival'], category: 'festival' },
	{ stems: ['marknad', 'marked', 'basar'], category: 'marknad' },
	{
		stems: ['teater', 'theatre', 'theater', 'revy', 'framsyning', 'forestilling'],
		category: 'teater'
	},
	{ stems: ['konsert', 'concert', 'musikk', 'music'], category: 'musikk' },
	{ stems: ['dans', 'dance'], category: 'dans' },
	{ stems: ['utstilling', 'exhibition'], category: 'utstilling' },
	{ stems: ['litteratur', 'literature'], category: 'litteratur' },
	{ stems: ['idrett', 'sport'], category: 'sport' },
	{ stems: ['gudsteneste', 'gudstjeneste', 'kyrkje', 'kirke'], category: 'kyrkjeliv' },
	{ stems: ['møte', 'meeting'], category: 'mote' }
];

/**
 * True when `word` is the stem, or a compound that opens or closes with it.
 *
 * Norwegian compounds carry the meaning in the last morpheme, so a substring test is not good
 * enough in either direction: `dansekurs` is a course and `ekskursjon` is not, because `kurs` sits
 * in the middle of it. `importers/bakhagen` found that one the expensive way.
 */
function carriesStem(word: string, stem: string): boolean {
	return word === stem || word.startsWith(stem) || word.endsWith(stem);
}

/**
 * The words of a term, plus the term with its separators closed up.
 *
 * A `tribe_events_cat` slug is hyphenated — `stand-up`, `teater-og-dans` — so splitting alone
 * would look for `standup` among `stand` and `up` and never find it. The joined form catches that
 * without letting a stem match across a word boundary it should not: `carriesStem` still only
 * looks at the two ends.
 */
function termForms(term: UpstreamCategory): string[] {
	const forms: string[] = [];
	for (const raw of [term.slug, decodeEntities(term.name)]) {
		const lowered = raw.toLowerCase();
		forms.push(...lowered.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
		forms.push(lowered.replace(/[^\p{L}\p{N}]+/gu, ''));
	}
	return forms;
}

export function mapCategory(
	categories: readonly UpstreamCategory[] | null | undefined,
	fallback: CategorySlug
): CategorySlug {
	const forms = (categories ?? []).flatMap(termForms);
	for (const rule of CATEGORY_RULES) {
		for (const form of forms) {
			if (rule.stems.some((stem) => carriesStem(form, stem))) return rule.category;
		}
	}
	return fallback;
}

/* -------------------------------------------------------------------------------------------- */
/* Images, venues, URLs                                                                           */
/* -------------------------------------------------------------------------------------------- */

/**
 * A URL we are willing to hand a reader, or null.
 *
 * Entities are decoded **before** parsing, and that is load-bearing rather than tidiness: the
 * plugin escapes the organiser's `website` the same way it escapes a title, so a real record in
 * the fixture carries `…watch?v=h-uHTKqLUd4&amp;t=7s`. Parsed as-is that is a working URL with a
 * query parameter called `amp;t`, which is a silently wrong link rather than a rejected one.
 */
function safeUrl(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(decodeEntities(value.trim()));
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
}

/** `false` is how the API spells "no featured image"; an object is the image. */
export function imageOf(input: UpstreamEvent): UpstreamImage | null {
	return input.image && typeof input.image === 'object' ? input.image : null;
}

/**
 * The WordPress rendition ladder as an `<img srcset>`.
 *
 * WordPress generates several sizes of every upload and the API lists them, so this source can
 * serve a card the width it actually needs instead of a 1500px original — the same win
 * `posterSrcset` was added for in schema.ts.
 *
 * **Crops are excluded by measuring, not by name.** `thumbnail` is 150×150 of a 1511×1008 photo:
 * a different picture, not a smaller one, and putting it in a `srcset` tells the browser it may
 * swap one for the other. So a rendition is kept only when its aspect ratio matches the full
 * image's. That rule holds for the next theme's custom size too, which a hardcoded exclusion list
 * would not.
 */
export function posterSrcsetFrom(image: UpstreamImage | null): string | null {
	if (!image) return null;
	const full = safeUrl(image.url);
	if (!full) return null;

	const fullWidth = image.width ?? null;
	const fullHeight = image.height ?? null;
	const fullRatio = fullWidth && fullHeight ? fullWidth / fullHeight : null;

	const candidates = new Map<number, string>();
	for (const size of Object.values(image.sizes ?? {})) {
		const url = safeUrl(size.url);
		if (!url || !size.width) continue;
		if (fullRatio && size.height) {
			const ratio = size.width / size.height;
			if (Math.abs(ratio - fullRatio) / fullRatio > 0.02) continue;
		}
		candidates.set(size.width, url);
	}
	if (fullWidth) candidates.set(fullWidth, full);

	// One size is not a ladder, and a srcset of one candidate only costs bytes.
	if (candidates.size < 2) return null;
	return [...candidates.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([width, url]) => `${url} ${width}w`)
		.join(', ');
}

/** `[]` is how the API spells "no venue"; an object is the venue. */
export function venueOf(input: UpstreamEvent) {
	return input.venue && !Array.isArray(input.venue) ? input.venue : null;
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

/* -------------------------------------------------------------------------------------------- */
/* The mapping                                                                                    */
/* -------------------------------------------------------------------------------------------- */

export type MappedEvent = {
	externalId: string;
	title: string;
	category: CategorySlug;
	startsAt: Date;
	endsAt: Date | null;
	venueName: string | null;
	venueSlug: string | null;
	/** Street, postnummer and town, where the instance filled them in. */
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

export function mapEvent(input: UpstreamEvent, instance: TecInstance): MappedEvent | MapFailure {
	/*
	 * The post id, as it comes.
	 *
	 * The free plugin gives one post per event, so this is a stable per-site identity and needs
	 * none of the `postId@instant` compounding `importers/mec` and `importers/bakhagen` had to do
	 * for sources that repeat one post across occurrences.
	 *
	 * The Events Calendar *Pro* adds recurring events, and if a site ever runs it the collection
	 * may repeat one id across occurrences. That would collapse a series into a single row that
	 * moves every day — so ingest.ts reports a repeated id as a rejection rather than quietly
	 * dropping it, which makes the day it happens visible and is the signal to compound the key
	 * here.
	 */
	const externalId = String(input.id);
	const title = plainText(input.title);
	if (!title) {
		return { externalId, title: '', problem: 'empty title' };
	}

	const zone = resolveZone(input.timezone, instance.timezone);

	const startsAt = wallClockToInstant(input.start_date, zone);
	if (!startsAt) {
		return { externalId, title, problem: `unreadable start_date: ${input.start_date}` };
	}

	let endsAt: Date | null = null;
	if (input.end_date) {
		const parsed = wallClockToInstant(input.end_date, zone);
		// An end that is not after the start is not an end. Dropped rather than stored, which is
		// what the UI already expects of an event whose duration nobody stated.
		if (parsed && parsed.getTime() > startsAt.getTime()) endsAt = parsed;
	}

	/*
	 * Whole-day events keep the source's own span, unchanged: local 00:00:00 → local 23:59:59.
	 *
	 * The same decision `importers/bakhagen` recorded, and for the same reasons. Inventing a
	 * plausible start hour so the card reads nicely would fabricate a time the organiser never
	 * gave, on a site people use to decide when to turn up; rejecting the event loses a real event
	 * over a detail the source was explicit about. Keeping the span is neither: `starts_at` at
	 * local midnight with `ends_at` at local 23:59:59 is an unambiguous, recoverable encoding of
	 * "all day" that a later `EventCard` change can read back and render as "Heile dagen".
	 *
	 * `isAllDay` therefore names and tests the condition without changing the output. It is the
	 * hook that display change will read, and it keeps this decision visible instead of leaving it
	 * as an unexplained pair of timestamps.
	 */

	const venue = venueOf(input);
	const venueName = decodeEntities(venue?.venue?.trim() ?? '') || instance.venueFallback;

	const description = plainText(input.description ?? '') || plainText(input.excerpt ?? '') || null;

	const image = imageOf(input);

	return {
		externalId,
		title,
		category: mapCategory(input.categories, instance.defaultCategory),
		startsAt,
		endsAt,
		venueName,
		venueSlug: slugifyVenue(venueName),
		/*
		 * The Events Calendar keeps a venue's street, postnummer and town in three fields, and this
		 * importer read only its name. `location.address` is required for Google's Event rich
		 * result and this is the least inferred source of one there is.
		 *
		 * Not every instance fills them — the plugin's demo data ships American addresses — so
		 * `fromParts` refusing anything without a house number matters here as much as anywhere.
		 */
		venueAddress: fromParts(venue?.address, venue?.zip, venue?.city),
		description,
		/*
		 * `website` is the organiser's own outbound link — a ticket shop, usually — and empty on
		 * most records. It is never our own page, so it is safe to hand a reader as the "buy" link;
		 * `sourceUrl` remains the calendar entry we read.
		 */
		ctaUrl: safeUrl(input.website),
		/*
		 * Hotlinked from the site's own media library, never copied onto our infrastructure.
		 *
		 * The plugin states nothing about image rights, so this cannot be read from the response —
		 * it comes from the instance config, which records whether that particular venue has
		 * agreed. An unstated right is still not a granted one.
		 */
		posterUrl: safeUrl(image?.url),
		posterSrcset: posterSrcsetFrom(image),
		posterRightsVerified: instance.posterRightsCleared,
		sourceUrl: safeUrl(input.url) ?? instance.url
	};
}
