import { fromParts, type ParsedAddress } from '@hendingar/core/address';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import { plainText } from '@hendingar/core/text';
import type { UpstreamEvent } from './api.ts';
import { eventUrl, type HooplaShop } from './shops.ts';

/**
 * Pure mapping: one Hoopla event → our shape. No I/O, no clock, no randomness (CLAUDE.md rule 6).
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
 * Hoopla's category vocabulary → ours.
 *
 * The ten values the bundle validates against, mapped to `packages/core/src/taxonomy.ts`. This is
 * the whole list, so an unmapped value means Hoopla added one — which lands on `anna` rather than
 * failing the event.
 *
 * Two entries are judgement calls and are written down as such:
 *
 *   - `SEMINAR` → `konferanse` rather than `mote`. Our `mote`/"Møte" is an organisation's own
 *     meeting — an annual general meeting, a club night. A seminar is a programme of talks you
 *     attend, which is the small end of `konferanse`.
 *   - `GATHERING` → `anna`. Hoopla labels it "Gathering/Party", which is two different events
 *     with two different answers in our taxonomy and no way to tell which from the field alone.
 *     Guessing `dans` or `mat-og-drikke` would invent a fact the source did not state, which is
 *     the reasoning `importers/mec` and `importers/luma` both record. `anna` is legitimate rather
 *     than a gap — the verifier's BLOCKING_CHECKS treat it as an answer.
 *
 * `SHOW` maps to `show` and not `teater`, even though every event in the committed fixture is
 * improvised theatre and says so in its title. Hoopla has no theatre category, so `teater` is
 * simply not something this source can tell us; reading it out of the title would be us deciding,
 * not the source saying. A person who submits or contributes to one of these can set it, and that
 * is a fact from somebody who was there.
 */
const CATEGORIES: Record<string, CategorySlug> = {
	CONCERT: 'musikk',
	CONFERENCE: 'konferanse',
	FESTIVAL: 'festival',
	SEMINAR: 'konferanse',
	COURSE: 'kurs',
	SHOW: 'show',
	SPORTS: 'sport',
	EXHIBITION: 'utstilling',
	GATHERING: 'anna',
	OTHER: 'anna'
};

export function categoryOf(event: UpstreamEvent): CategorySlug {
	const raw = event.data.category?.trim().toUpperCase();
	if (!raw) return 'anna';
	return CATEGORIES[raw] ?? 'anna';
}

/**
 * Is this event ours to republish?
 *
 * Counted as skipped rather than rejected by `ingest.ts`: nothing has changed shape, this is
 * simply a row the shop holds that a what's-on listing should not repeat. `rejected` has to go on
 * meaning "the source moved".
 *
 * Only cancellation disqualifies an event. In particular **neither `sale_state` nor
 * `availability` is a filter**, and that is deliberate: `SOLD_OUT` is a fact about tickets, not
 * about whether the thing is happening, and a reader who wants to know what is on in town this
 * Friday is still served by a sold-out show — they may know somebody with a spare, and we link
 * to the shop so they can see the state for themselves. We are an index, not a ticket counter.
 */
export function isPublishable(event: UpstreamEvent): boolean {
	return event.is_cancelled !== true;
}

/**
 * The venue's name, with the street address taken back out of it.
 *
 * Hoopla gives the organiser one free-text box for the venue name and separate boxes for the
 * address, and this organiser has typed the address into both. The fixture holds the same room
 * twice, spelled two ways:
 *
 *   `"Torget 10 - Vikjoscenen "`  (event 983124565)
 *   `"Vikjoscenen - Torget 10"`   (event 1507533914)
 *
 * with `street_address: "Torget 10"` on both. Left alone, those slugify to two different venues,
 * so one room becomes two rows — two entries wherever venues are listed, and two half-histories
 * of a place that has one. Nothing downstream could detect it, because both rows are individually
 * correct.
 *
 * So when the name contains the street we already have in its own column, the street comes out
 * and the leftover separators are trimmed. Both spellings become `Vikjoscenen`, which is not just
 * de-duplicated but *better*: `venues.name` is for the name of the place, and the address has
 * three columns of its own.
 *
 * Deliberately narrow. It removes only a string the source itself has already told us is the
 * street address of this very event, which is why it cannot invent or corrupt a name — "Gruo pub"
 * and "Den Blå Time" pass through untouched, and a venue genuinely called "Torget 10" keeps its
 * name because removing it would leave nothing and the fallback below declines to return empty.
 *
 * Not a job for `packages/core/src/venue-aliases.ts`, which is the other half of this problem and
 * worth not confusing with it. That list resolves what *different sources* call one building, so
 * `pnpm consolidate` can tell that two calendars are describing the same show; it is consulted
 * when events are compared, long after `venues` rows exist. This is one source spelling one room
 * two ways in one payload, which would make two `venues` rows before consolidation ever looks —
 * so it has to be fixed here, on the way in. An alias entry would also have to be written per
 * spelling, and the point of doing it in code is that the next thing this organiser types is
 * already handled.
 */
export function venueNameOf(event: UpstreamEvent): string | null {
	const raw = event.data.location?.name?.trim();
	if (!raw) return null;
	const street = event.data.location?.street_address?.trim();
	if (!street) return raw;

	const withoutStreet = raw
		.replace(new RegExp(escapeForRegExp(street), 'gi'), ' ')
		// The separators the two spellings leave behind — a dash, a comma, or both.
		.replace(/[\s,–—-]+/g, ' ')
		.trim();
	return withoutStreet || raw;
}

/** So a street containing `.` or `(` cannot compile into a pattern that matches something else. */
function escapeForRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The address, from the three fields Hoopla keeps apart.
 *
 * `fromParts` and not `fromLine`: the source already separates street, postnummer and post town,
 * so nothing needs inferring — "the clean case, and the one to prefer wherever a source offers
 * it", in that function's own words.
 *
 * The post town does NOT become `venues.municipality`. `5410 Sagvåg` is in the fixture, and
 * Sagvåg is a village in Stord rather than a municipality; the allevents, TEC, aktivitetforalle
 * and luma importers all record the same refusal, because writing a post town into a column
 * called `municipality` is wrong in a way nothing downstream can detect. Where those names *are*
 * used is `packages/core/src/coverage.ts`, which knows Sagvåg is in Stord and is asked at
 * submission time, not here.
 */
export function addressOf(event: UpstreamEvent): ParsedAddress {
	const loc = event.data.location;
	return fromParts(loc?.street_address, loc?.postal_code, loc?.postal_area);
}

/**
 * The event image, hotlinked through Hoopla's own image CDN.
 *
 * `images.url` is a bare storage path (`254371621/Logo.1786472946.jpg`), not a URL. The shop's
 * own client turns it into one by prefixing `https://hoopla.twic.pics/<env>/` and asking TwicPics
 * for `output=auto`, which is what the shop's `og:image` also does — so this is the source's own
 * published form of its own image, verified to answer `200 image/jpeg`.
 *
 * Uncropped, though Hoopla offers three crop rectangles. The crops are framing decisions made for
 * the shop's own card layout, and we have our own — `poster_srcset` and the verifier's `crop.py`
 * exist to decide where to cut a thumbnail. Handing them the whole image leaves that decision
 * where it belongs; baking in a 16:9 letterbox would not be undoable.
 *
 * `16x9` is preferred only as the *source path* to read, because it is the one crop present on
 * every row; all three point at the same underlying file anyway.
 */
export function posterUrlOf(event: UpstreamEvent): string | null {
	const path =
		event.images?.crop16x9?.url?.trim() ||
		event.images?.crop4x3?.url?.trim() ||
		event.images?.crop1x1?.url?.trim();
	if (!path) return null;
	// `encodeURI`, so a space in a filename cannot produce an invalid URL, while the path
	// separators stay separators — the form the site itself publishes.
	return `https://hoopla.twic.pics/production/${encodeURI(path)}?twic=v1/output=auto`;
}

export function mapEvent(event: UpstreamEvent, shop: HooplaShop): MappedEvent | MapFailure {
	/*
	 * The event's own id, on its own, and not the start instant or the day.
	 *
	 * CLAUDE.md: never key an `external_id` on the start instant, because correcting a time then
	 * changes the key, inserts a second row and abandons the first — still published, still wrong.
	 * `importers/mec` appends the day because MEC reuses one upstream id across every occurrence
	 * of a series, so the id alone cannot tell two nights apart.
	 *
	 * Hoopla needs neither. Each night of this improv run is a separate `event_id` with its own
	 * ticket inventory — that is what the shop is selling — so the bare id is unique AND survives
	 * a re-time: an event moved from Friday to Saturday updates in place, where `<id>@<day>` would
	 * fork it.
	 */
	const externalId = String(event.event_id);
	const title = event.name.trim();
	if (!title) return { externalId, title: '', problem: 'no title' };

	const startsAt = new Date(event.start);
	if (!Number.isFinite(startsAt.getTime())) {
		return { externalId, title, problem: `unparseable start '${event.start}'` };
	}

	const endsAtRaw = event.end ? new Date(event.end) : null;
	/*
	 * An end before its start is dropped rather than stored. A negative duration is not a fact
	 * about the event; it renders as a listing entry that claims to finish before it begins.
	 * Losing the end time keeps the event, which is the half that matters.
	 */
	const endsAt =
		endsAtRaw && Number.isFinite(endsAtRaw.getTime()) && +endsAtRaw > +startsAt ? endsAtRaw : null;

	const venueName = venueNameOf(event);
	const address = addressOf(event);
	const coordinates = event.data.location?.coordinates ?? null;

	return {
		externalId,
		title,
		category: categoryOf(event),
		startsAt,
		endsAt,
		venueName,
		venueSlug: venueName ? slugifyVenue(`${venueName} ${address.city ?? ''}`) : null,
		venueAddress: address,
		latitude: coordinates?.latitude ?? null,
		longitude: coordinates?.longitude ?? null,
		/*
		 * The shop's zone. A zone and never an offset: `start` is an instant, so the wall clock a
		 * reader should see is only recoverable with a zone, and a zone is the only one of the two
		 * still true after the clocks change.
		 *
		 * Per-shop rather than hardcoded, from `window.ORGANIZATION_TIMEZONE` in the shop's own
		 * HTML. Hoopla runs shops outside Norway (`hooplatickets.twic.pics` is its UK image host),
		 * so `Europe/Oslo` is a fact about this organiser and not about the platform.
		 */
		venueTimezone: shop.timezone,
		/*
		 * Filled in by `ingest.ts` from the event's own record, because the list carries no prose:
		 * `short_description` is null on every row and there is no `description` field at all.
		 *
		 * Worth the extra request here, where `importers/luma` declined it. Two differences: the
		 * list is a single unpaginated call for the whole shop rather than a paginated crawl, so
		 * one request per event is a bounded cost on a small shop; and these descriptions carry
		 * the detail a reader actually needs — the door time, the show time, and in event
		 * 983124565 a workshop beforehand with limited places, none of which appears anywhere
		 * else.
		 */
		description: null,
		/*
		 * Null, though the event page is also where you buy the ticket.
		 *
		 * On Hoopla "read more" and "buy" are one URL. Naming it as both `source_url` and
		 * `cta_url` would render two identical buttons on the card and double-count the click, so
		 * it is named once, as the source — which is the promise we actually make: every imported
		 * event keeps a link to where it came from.
		 */
		ctaUrl: null,
		posterUrl: posterUrlOf(event),
		posterRightsVerified: shop.posterRightsCleared,
		sourceUrl: eventUrl(shop, event.event_id)
	};
}

/**
 * The description, once the detail record has been read.
 *
 * Separate from `mapEvent` so the mapper stays pure and `ingest.ts` owns the I/O. `plainText`
 * because the field is the organiser's own text box: the fixtures hold plain text with blank
 * lines between paragraphs, but a rich-text editor on Hoopla's side would start sending markup
 * without warning, and `plainText` is safe to run on text that was never markup.
 */
export function describe(raw: string | null): string | null {
	return plainText(raw);
}
