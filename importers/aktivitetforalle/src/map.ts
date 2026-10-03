import { zonedWallClockToInstant } from '@hendingar/core/datetime';
import { classifyEventKind } from '@hendingar/core/standing';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import type { Weekday } from '@hendingar/core/recurrence';
import {
	weeklyHoursSchema,
	type WeeklyCadence,
	type WeeklyHours
} from '@hendingar/core/weekly-hours';
import { orNull, type FilterVocabulary, type UpstreamEvent, type UpstreamUpload } from './api.ts';
import { activityUrl, eventUrl, listingUrl, type AfaSite } from './sites.ts';
import { fromParts, type ParsedAddress } from '@hendingar/core/address';

/**
 * Pure mapping: one portal row → our shape. No I/O, no clock, no randomness.
 */

/**
 * The portal's category vocabulary → our taxonomy.
 *
 * Keyed on the filter's NAME rather than its id: the ids are per-site database keys, and the same
 * category carries a different number on the next municipality's portal, while the vocabulary
 * itself is shared by the platform. Names that describe an audience or a facility rather than a
 * kind of event fall through to `anna`.
 */
const CATEGORY_BY_NAME: Record<string, CategorySlug> = {
	musikk: 'musikk',
	konsert: 'musikk',
	teater: 'teater',
	underholdning: 'show',
	utstilling: 'utstilling',
	kunst: 'utstilling',
	idrett: 'sport',
	'fysisk aktivitet/friluftsliv': 'sport',
	'stemne/cup/turnering': 'sport',
	konkurranse: 'sport',
	'mat & drikke': 'mat-og-drikke',
	'kurs & konferanse': 'kurs',
	kurs: 'kurs',
	dans: 'dans',
	marknad: 'marknad',
	livssyn: 'kyrkjeliv',
	litteratur: 'litteratur',
	'samfunn & politikk': 'mote',
	foredrag: 'mote',
	festival: 'festival',
	feiring: 'festival',
	/*
	 * The activity vocabulary. Same platform, a second set of names: an `activity` is tagged
	 * "Tru og livssyn" where an `arrangement` is tagged "Livssyn". "Fritid og sosialt", "Hobby",
	 * "Kunst og handtverk", "Spill" and "Digitalt" are left to fall through — a knitting circle is
	 * not an exhibition, and `anna` is more honest than the nearest wrong slug.
	 */
	'tru og livssyn': 'kyrkjeliv',
	drama: 'teater',
	friluftsliv: 'sport',
	'samfunn og politikk': 'mote'
};

export function mapCategory(
	filterIds: readonly string[],
	vocabulary: FilterVocabulary
): CategorySlug {
	for (const id of filterIds) {
		const filter = vocabulary.get(id);
		if (filter?.type !== 'category') continue;
		const hit = CATEGORY_BY_NAME[filter.name.trim().toLowerCase()];
		if (hit) return hit;
	}
	return 'anna';
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

/**
 * Is this a dated event we should list?
 *
 * The portal holds two kinds of row, and says which: `arrangement` is a dated event — a concert,
 * a quiz night — and `activity` is a standing weekly offer, see `isPublishableActivity`.
 *
 * Filtering on `event_type` rather than on the audience tags the portal's own URL uses. Those tags
 * happen to correlate — ids 81–85 sit on `arrangement` rows and 38–42 on `activity` rows — but the
 * correlation is not the rule: **fifty-six of the hundred and twenty-two public events carry no
 * audience tag at all**, and they include Sigvart Dagsland, Riksteatret and Teater Vestland. A
 * filter built on the tags silently drops half the programme, and the better half.
 */
export function isPublishableEvent(input: UpstreamEvent, timeZone: string): boolean {
	if (orNull(input.event_status) !== 'public') return false;
	if (orNull(input.event_type) !== 'arrangement') return false;
	/*
	 * And it must say when.
	 *
	 * One public event — "Rema Cup 2026" — carries an end time and no start, which is a gap in the
	 * portal's own record rather than a change in its shape. Checking it here rather than letting
	 * `mapEvent` reject it keeps `rejected` meaning "the source moved": an event with no start
	 * cannot be placed on a day, so there is nothing to list and nothing to report as broken.
	 */
	return toInstant(orNull(input.event_from), timeZone) !== null;
}

/**
 * Is this a standing weekly activity we should list on /alltid-ope?
 *
 * "Bremnes G12, tysdag og onsdag 18:00–19:30, januar til desember." These were dropped for a long
 * time, on purpose: imported as dated events they would bury sixty real events under hundreds of
 * gym sessions, and imported as plain standing offers they made `/alltid-ope` fifty training
 * schedules with a museum in the middle (ADR 0013). They come in now because they have somewhere
 * of their own — one row each, with a timetable, grouped by who runs them. See
 * docs/decisions/0021-weekly-activities.md.
 *
 * Three conditions beyond `public`, each of which keeps a row out of somewhere it would do harm:
 *
 * - **A season, not a date.** The row must classify as `standing` from its own dates, so it can
 *   never land in a day list. The generated `events.kind` column decides that in the database; the
 *   same rule is applied here so an activity that would come out `dated` — a fortnight's course —
 *   is skipped rather than filed under midnight on its first day.
 * - **A timetable.** Something that repeats without saying when — three such rows, "badebursdag"
 *   among them — gives a reader nothing to go to. It stays with the source.
 * - **A start and an end that parse**, for the same reason as an event's start above.
 */
export function isPublishableActivity(input: UpstreamEvent, timeZone: string): boolean {
	if (orNull(input.event_status) !== 'public') return false;
	if (orNull(input.event_type) !== 'activity') return false;
	if (!Array.isArray(input.event_weekdays) || input.event_weekdays.length === 0) return false;
	const from = toInstant(orNull(input.event_from), timeZone);
	const to = toInstant(orNull(input.event_to), timeZone);
	if (!from || !to) return false;
	return classifyEventKind(from, to) === 'standing';
}

const WEEKDAY_BY_NAME: Record<string, Weekday> = {
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
	sunday: 7
};

/**
 * The platform's interval → ours. Null is "Kvar veke": that is what the portal's own page prints
 * for the thirty-seven activities that leave it unset, checked in a browser rather than assumed.
 */
const CADENCE_BY_INTERVAL: Record<string, WeeklyCadence> = {
	'each-week': 'weekly',
	'even-weeks': 'even-weeks',
	'odd-weeks': 'odd-weeks',
	'first-of-month': 'first-of-month',
	'last-of-month': 'last-of-month'
};

/** "18:00:00" → "18:00". The portal states seconds it never uses. */
function hhmm(value: unknown): string | null {
	const match = /^(\d{2}:\d{2})(:\d{2})?$/.exec(String(value ?? '').trim());
	return match ? match[1]! : null;
}

/**
 * `event_weekdays` + `event_week_interval` → a timetable, or the reason it is not one.
 *
 * Strict where `api.ts` is loose. An interval we have no word for is a failure, not a default: a
 * fortnightly service shown as weekly sends someone to a locked church, so a new value must
 * surface as a rejected row and be named, never quietly become "kvar veke".
 *
 * The times are a wall clock and stay one — the portal shows "Tysdag kl. 18:00 - 19:30", which is
 * exactly what we store and exactly what we show. Nothing resolves them to an instant, so there is
 * no offset to get wrong.
 */
export function mapWeeklyHours(input: UpstreamEvent): WeeklyHours | { problem: string } {
	const interval = orNull(input.event_week_interval);
	const cadence = interval === null ? 'weekly' : CADENCE_BY_INTERVAL[interval];
	if (!cadence) return { problem: `unknown event_week_interval: ${interval}` };

	const raw = Array.isArray(input.event_weekdays) ? input.event_weekdays : [];
	const slots = raw.map((entry: unknown) => {
		const record = typeof entry === 'object' && entry !== null ? entry : {};
		const value = 'value' in record ? String(record.value).toLowerCase() : '';
		return {
			weekday: WEEKDAY_BY_NAME[value],
			from: hhmm('from_time' in record ? record.from_time : null),
			to: hhmm('to_time' in record ? record.to_time : null)
		};
	});

	const parsed = weeklyHoursSchema.safeParse({ cadence, slots });
	if (!parsed.success) {
		return { problem: `unreadable event_weekdays: ${JSON.stringify(input.event_weekdays)}` };
	}
	return parsed.data;
}

export type MappedEvent = {
	externalId: string;
	title: string;
	category: CategorySlug;
	startsAt: Date;
	endsAt: Date | null;
	venueName: string | null;
	venueSlug: string | null;
	/** Street, postnummer and town, where the portal gave us them. */
	venueAddress: ParsedAddress;
	description: string | null;
	ctaUrl: string | null;
	posterUrl: string | null;
	/** The same poster at every width the portal renders it, or null where it renders only one. */
	posterSrcset: string | null;
	posterRightsVerified: boolean;
	sourceUrl: string;
	/** Who runs it, by the name the portal shows. */
	organizerName: string | null;
	/** Set for an `activity`, null for an `arrangement` — see `isPublishableActivity`. */
	weeklyHours: WeeklyHours | null;
	/** Who it is for, inclusive. Both null: the source says everyone, or nothing. */
	ageFrom: number | null;
	ageTo: number | null;
};

export type MapFailure = { externalId: string; title: string; problem: string };

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}

/**
 * A URL the portal gave us, made absolute.
 *
 * `base` is not a convenience. The upload URLs were absolute when this importer was written and are
 * root-relative now, and without a base `new URL('/uploads/…')` throws — which this function used
 * to answer with `null`, i.e. "no poster", for every event on the portal. A base makes both spellings
 * resolve to the same address, so the next change of mind upstream costs nothing.
 */
function safeUrl(value: string | null, base?: string): string | null {
	if (!value) return null;
	try {
		const u = base ? new URL(value, base) : new URL(value);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
	} catch {
		return null;
	}
}

/** "1920x1005" → 1.910…, and null for anything else. The original's shape, to catch a crop. */
function aspectOf(resolution: string | null): number | null {
	const match = /^(\d+)\s*[x×]\s*(\d+)$/.exec((resolution ?? '').trim());
	if (!match) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	return width > 0 && height > 0 ? width / height : null;
}

/**
 * Which rendition format to build the ladder from, best first.
 *
 * **One format for the whole ladder.** A browser picks a `srcset` candidate on width alone: list a
 * webp beside a jpeg and you have told it the two are interchangeable, which they are not for
 * anything that cannot decode the one it happens to choose.
 *
 * webp first — every browser that understands `srcset` understands webp, and the portal serves it
 * with its real media type. avif last, not never: the uploads from before the platform's redesign
 * have an avif ladder and nothing else, and the alternative for those is hotlinking the original,
 * one of which is a 1.4 MB PNG painted into an 88px square on a phone. The portal mislabels avif as
 * `application/octet-stream`, which browsers sniff past; a rendition that does fail to decode
 * leaves `EventThumb` showing its generated tile, not a broken image.
 */
const FORMAT_RANK = ['webp', 'jpeg', 'jpg', 'png', 'avif'];

function formatOf(variant: { name: string; mime?: string | null; format?: string | null }): string {
	const fromMime = variant.mime?.trim().toLowerCase().replace('image/', '');
	const fromName = /\.([a-z0-9]+)$/i.exec(variant.name)?.[1]?.toLowerCase();
	return (variant.format?.trim().toLowerCase() || fromMime || fromName) ?? '';
}

/**
 * The platform's rendition ladder as an `<img srcset>`.
 *
 * The widest a card is ever painted is 434 CSS pixels — 868 device pixels on a 2× screen — and the
 * originals here run to 1920px and a megabyte and a half. The ladder is listed in the same response
 * as the event, and every rendition sits beside the original under the same hashed directory, so
 * addressing one costs no extra request: `original-640w.webp` resolves against the original's URL.
 *
 * A rendition is kept only when its proportions match the original's. The platform has only ever
 * generated resizes, but `upload_resolution` is right there, and a `srcset` that quietly offers a
 * square crop as a smaller version of a landscape poster is the kind of thing nobody notices until
 * a face is cut in half.
 */
export function posterSrcsetFrom(upload: UpstreamUpload, posterUrl: string): string | null {
	const variants = upload.upload_variants ?? [];
	if (variants.length === 0) return null;

	const original = aspectOf(orNull(upload.upload_resolution));

	const byFormat = new Map<string, Map<number, string>>();
	for (const variant of variants) {
		if (variant.upload_exists === false) continue;
		const width = variant.width ?? null;
		if (!width || width <= 0) continue;
		if (original && variant.height) {
			const ratio = width / variant.height;
			if (Math.abs(ratio - original) / original > 0.02) continue;
		}
		const url = safeUrl(variant.name, posterUrl);
		if (!url) continue;
		const format = formatOf(variant);
		const ladder = byFormat.get(format) ?? new Map<number, string>();
		ladder.set(width, url);
		byFormat.set(format, ladder);
	}

	for (const format of FORMAT_RANK) {
		const ladder = byFormat.get(format);
		// One candidate is not a ladder: it only costs bytes to send a browser a choice of one.
		if (!ladder || ladder.size < 2) continue;
		return [...ladder.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([width, url]) => `${url} ${width}w`)
			.join(', ');
	}
	return null;
}

/**
 * "2026-09-18 19:00:00" → an instant.
 *
 * There is no offset anywhere in the payload, so the string is a wall clock in the municipality's
 * own zone and has to be resolved against it. Handing it to `new Date()` would read it as the
 * *server's* local time — correct on a laptop in Norway, an hour or two wrong in CI, which is the
 * kind of bug that only shows up in production.
 */
export function toInstant(value: string | null, timeZone: string): Date | null {
	if (!value) return null;
	const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value.trim());
	if (!match) return null;
	try {
		return zonedWallClockToInstant(match[1]!, match[2]!, timeZone);
	} catch {
		return null;
	}
}

export function mapEvent(
	input: UpstreamEvent,
	site: AfaSite,
	vocabulary: FilterVocabulary,
	locations: Map<string, string>,
	organizers: Map<string, string> = new Map()
): MappedEvent | MapFailure {
	const externalId = String(input.event_id);
	const title = input.event_title.trim().replace(/\s+/g, ' ');

	if (!title) return { externalId, title: '', problem: 'empty title' };

	const isActivity = orNull(input.event_type) === 'activity';
	let weeklyHours: WeeklyHours | null = null;
	if (isActivity) {
		const hours = mapWeeklyHours(input);
		if ('problem' in hours) return { externalId, title, problem: hours.problem };
		weeklyHours = hours;
	}

	const startsAt = toInstant(orNull(input.event_from), site.timezone);
	if (!startsAt) {
		return { externalId, title, problem: `unusable event_from: ${input.event_from}` };
	}

	const endsAtRaw = toInstant(orNull(input.event_to), site.timezone);
	const endsAt = endsAtRaw && endsAtRaw.getTime() > startsAt.getTime() ? endsAtRaw : null;

	/*
	 * A venue is named one of two ways, and the row says which: `custom` puts the name inline,
	 * `location` points at a row in /api/v1/locations. Reading only the inline field would leave
	 * forty-four of the hundred and twenty-two events with no place at all.
	 */
	const venueName =
		orNull(input.event_location_custom_title) ??
		(input.event_location_id != null
			? (locations.get(String(input.event_location_id)) ?? null)
			: null);

	/*
	 * Resolved against the site's origin, because the portal spells these two ways — see
	 * `upload_url` in api.ts for what that cost. `upload_exists` is the portal's own word for a file
	 * it no longer holds, and linking one is a broken image on a card.
	 */
	const thumbnail = input.event_thumbnail;
	const usable =
		thumbnail && thumbnail.upload_public !== false && thumbnail.upload_exists !== false
			? thumbnail
			: null;
	const poster = usable ? safeUrl(orNull(usable.upload_url), site.origin) : null;

	const filterIds = (input.event_filter_ids ?? []).map(String);

	return {
		externalId,
		title,
		category: mapCategory(filterIds, vocabulary),
		startsAt,
		endsAt,
		venueName,
		venueSlug: venueName ? slugifyVenue(venueName) : null,
		/*
		 * The portal keeps street, postnummer and town in three fields, and this importer was
		 * dropping all three. `location.address` is required for Google's Event rich result, and
		 * this is the cleanest source of one we have: nothing is inferred, the fields are already
		 * apart. `fromParts` still refuses anything without a house number, so a room name in the
		 * street field does not become a street.
		 */
		venueAddress: fromParts(
			orNull(input.event_location_address1),
			orNull(input.event_location_zip),
			orNull(input.event_location_city)
		),
		description: orNull(input.event_description) ?? orNull(input.event_summary),
		ctaUrl: safeUrl(orNull(input.event_ticket_link)),
		posterUrl: poster,
		posterSrcset: usable && poster ? posterSrcsetFrom(usable, poster) : null,
		/*
		 * Hotlinked, and recorded as unverified.
		 *
		 * The images are uploaded by whichever organisation registered the event, and the portal
		 * states nothing about their licensing. An unstated right is not a granted one — the same
		 * reasoning as the MEC importer, where the venues did agree and it is recorded because
		 * they did.
		 */
		posterRightsVerified: false,
		/*
		 * The event's own page. Verified in a browser rather than assumed: the route is rendered
		 * client-side, so an archived id returns HTTP 200 with a shell and only becomes "Ikkje
		 * funne" once the script runs. Every id we import is `public`, which is exactly the set
		 * whose pages resolve.
		 */
		sourceUrl: isActivity
			? activityUrl(site, externalId)
			: eventUrl(site, externalId) || listingUrl(site),
		organizerName:
			input.organizer_id != null
				? (organizers.get(String(input.organizer_id)) ?? orNull(input.event_organizer_name))
				: orNull(input.event_organizer_name),
		weeklyHours,
		...mapAgeRange(input)
	};
}

/**
 * `event_age_type` + the two bounds → an inclusive range, or none.
 *
 * `all` is the portal's "for alle" and maps to no range, which is what every reader of these
 * columns takes as everyone. A range with a bound that is not a sensible age — a typo of 1000, a
 * negative, from after to — is dropped whole rather than half-kept: a filter that hides a squad
 * from the parents it is for is worse than one that shows it to a few it is not.
 */
export function mapAgeRange(input: UpstreamEvent): {
	ageFrom: number | null;
	ageTo: number | null;
} {
	const none = { ageFrom: null, ageTo: null };
	if (orNull(input.event_age_type) !== 'range') return none;
	const from = Number(orNull(input.event_age_from) ?? NaN);
	const to = Number(orNull(input.event_age_to) ?? NaN);
	const sane = (n: number) => Number.isInteger(n) && n >= 0 && n <= 120;
	if (!sane(from) || !sane(to) || from > to) return none;
	return { ageFrom: from, ageTo: to };
}
