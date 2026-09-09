import { fromLine, titleCasePlace, NO_ADDRESS, type ParsedAddress } from '@hendingar/core/address';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import type { UpstreamEntry } from './api.ts';
import { eventUrl, type LumaCalendar } from './calendars.ts';

/**
 * Pure mapping: one Luma entry → our shape. No I/O, no clock, no randomness (CLAUDE.md rule 6).
 */

export type MappedEvent = {
	externalId: string;
	title: string;
	category: CategorySlug;
	startsAt: Date;
	endsAt: Date | null;
	venueName: string | null;
	venueSlug: string | null;
	venueAddress: ParsedAddress;
	/** Google's coordinate for the place, as Luma reports it. Null unless the payload had one. */
	latitude: number | null;
	longitude: number | null;
	venueTimezone: string;
	description: string | null;
	ctaUrl: string | null;
	posterUrl: string | null;
	posterRightsVerified: boolean;
	sourceUrl: string;
};

export type MapFailure = { externalId: string; title: string; problem: string };

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}

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

/**
 * Is this entry ours to republish?
 *
 * Counted as skipped rather than rejected by `ingest.ts`: nothing has changed shape, these are
 * simply rows the calendar holds that a what's-on listing should not repeat. `rejected` has to go
 * on meaning "the source moved".
 *
 * `status` is the calendar admin's own decision — Luma lets anybody submit to a public calendar and
 * holds it as `pending` until an admin approves. Republishing a pending submission would put an
 * event on our listing that is not yet on the organiser's own.
 */
export function isPublishable(entry: UpstreamEntry): boolean {
	if (entry.event.visibility && entry.event.visibility !== 'public') return false;
	if (entry.status && entry.status !== 'approved') return false;
	/*
	 * Online-only events are dropped.
	 *
	 * This is a local what's-on listing: "where is it" is the question every reader is asking, and
	 * a webinar has no answer. `hybrid` is kept — it happens somewhere as well as online.
	 */
	return entry.event.location_type !== 'online';
}

/**
 * Where the event is, as a venue name.
 *
 * Luma has no venue-name field. It has `geo_address_info.address`, which is whatever the organiser
 * picked out of Google's autocomplete — and in the committed fixtures that is a **named place** on
 * two rows ("Sams senter") and a **street number** on the other two ("Sæ 134", "Rundehaugen 17").
 * The same field, both meanings, with nothing to tell them apart.
 *
 * So it is used as the name either way, and a street sometimes ends up in `venues.name`. That is
 * inelegant and it is what the source says. The alternative was to infer a building name from the
 * coordinate, which is the geocoding mistake `packages/core/src/address.ts` already records:
 * Kartverket resolved "Øklandstunet" to a lake, and a wrong venue name sends somebody to the wrong
 * building.
 *
 * It costs nothing on the address side, because `fromLine` reads the street out of the full line
 * regardless — "Sams senter, Bankbrekko 22, 5430 Bremnes, Norway" yields `Bankbrekko 22` and
 * refuses to treat the venue name as a street, which is the case its own docstring was written for.
 */
function venueNameOf(entry: UpstreamEntry): string | null {
	const geo = entry.event.geo_address_info;
	if (!geo) return null;
	const street = geo.address?.trim();
	if (street) return street;
	const city = geo.city?.trim();
	return city ? titleCasePlace(city) : null;
}

/**
 * The address, from the Norwegian rendering where Luma offers one.
 *
 * `localized.no.full_address` is "Sæ 134, 5417 Stord, Norge" — street, postnummer, post town, in
 * the order and shape `fromLine` was written for. The top-level `full_address` is the same line
 * ending "Norway" and is the fallback.
 *
 * The post town does NOT become `venues.municipality`. "Bremnes" is in the committed fixture and
 * stopped being a municipality in 1963; the allevents, TEC and aktivitetforalle importers all
 * record the same refusal, because writing a post town into a column called `municipality` is
 * wrong in a way nothing downstream can detect.
 */
function addressOf(entry: UpstreamEntry): ParsedAddress {
	const geo = entry.event.geo_address_info;
	if (!geo) return NO_ADDRESS;
	const line = geo.localized?.no?.full_address?.trim() || geo.full_address?.trim() || '';
	const parsed = fromLine(line);
	if (parsed.street || parsed.postalCode || parsed.city) return parsed;
	/*
	 * `fromLine` returns nothing at all unless the first segment looks like a street address, which
	 * is the right refusal there — a venue name in a street field must not become `streetAddress`.
	 * When it declines, the discrete fields are still worth having.
	 */
	return {
		street: null,
		postalCode: null,
		city: geo.city?.trim() ? titleCasePlace(geo.city.trim()) : null
	};
}

function safeUrl(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
}

export function mapEntry(entry: UpstreamEntry, calendar: LumaCalendar): MappedEvent | MapFailure {
	const event = entry.event;
	/*
	 * The event's own id, on its own, and not the start instant or the day.
	 *
	 * CLAUDE.md: never key an `external_id` on the start instant, because correcting a time then
	 * changes the key, inserts a second row and abandons the first — still published, still wrong.
	 * `importers/mec` appends the day (`<id>@2026-09-07`) because MEC reuses one upstream id across
	 * every occurrence of a series, so the id alone cannot tell two nights apart.
	 *
	 * Luma needs neither, and adding the day would be actively worse: every occurrence has its own
	 * `evt-…`, so the bare id is unique AND survives a re-time — an event moved from Thursday to
	 * Friday updates in place, where `<id>@<day>` would fork it. `recurrence_id` is declared in
	 * api.ts as the thing to check if that ever stops being true.
	 */
	const externalId = event.api_id;
	const title = event.name.trim();
	if (!title) return { externalId, title: '', problem: 'no title' };

	const startsAt = new Date(event.start_at);
	if (!Number.isFinite(startsAt.getTime())) {
		return { externalId, title, problem: `unparseable start_at '${event.start_at}'` };
	}

	const endsAtRaw = event.end_at ? new Date(event.end_at) : null;
	/*
	 * An end before its start is dropped rather than stored.
	 *
	 * A negative duration is not a fact about the event; it renders as a listing entry that claims
	 * to finish before it begins. Losing the end time keeps the event, which is the half that
	 * matters.
	 */
	const endsAt =
		endsAtRaw && Number.isFinite(endsAtRaw.getTime()) && +endsAtRaw > +startsAt ? endsAtRaw : null;

	const path = event.url?.trim();
	if (!path) return { externalId, title, problem: 'no event path to link to' };
	const sourceUrl = eventUrl(path);

	const venueName = venueNameOf(entry);

	return {
		externalId,
		title,
		/*
		 * `anna`, for every event, on purpose.
		 *
		 * `get-items` states no category — Luma has no category field, and this calendar's `tags`
		 * array is empty on every row. Guessing one from a listing that states none is inventing a
		 * fact, which is the reasoning `importers/mec` already records and the reason the
		 * verification pipeline treats `anna` as legitimate rather than as a gap (see
		 * BLOCKING_CHECKS in services/verifier).
		 *
		 * A per-calendar default was considered — "Tech Cluster West" runs meetups, so `mote` would
		 * fit — and rejected for the same reason: it is still a claim about an individual event
		 * that the source never made. A person who submits or contributes to one of these can set
		 * the category, and that is a fact from somebody who was there.
		 */
		category: 'anna',
		startsAt,
		endsAt,
		venueName,
		venueSlug: venueName ? slugifyVenue(`${venueName} ${addressOf(entry).city ?? ''}`) : null,
		venueAddress: addressOf(entry),
		latitude: event.geo_address_info?.place_coordinate?.latitude ?? null,
		longitude: event.geo_address_info?.place_coordinate?.longitude ?? null,
		/*
		 * The event's own zone, then the calendar's.
		 *
		 * A zone and never an offset: `starts_at` is an instant, so the wall clock a reader should
		 * see is only recoverable with a zone, and a zone is the only one of the two still true
		 * after the clocks change.
		 */
		venueTimezone: event.timezone?.trim() || calendar.timezone,
		/*
		 * No description, and none invented.
		 *
		 * `get-items` carries no description field at all. The event's own page has one, and
		 * fetching one page per event to get it would turn a single API call into a crawl of the
		 * calendar — ADR 0004 wants importers cheap and replayable, and a description is the field
		 * a reader misses least when the title and the link are right.
		 */
		description: null,
		/*
		 * Null, though the event page is also the registration page.
		 *
		 * On Luma "read more" and "sign up" are one URL. Naming it as both `source_url` and
		 * `cta_url` would render two identical buttons on the card and double-count the click
		 * event, so it is named once, as the source — which is the promise we actually make: every
		 * imported event keeps a link to where it came from.
		 */
		ctaUrl: null,
		posterUrl: safeUrl(event.cover_url),
		posterRightsVerified: calendar.posterRightsCleared,
		sourceUrl
	};
}
