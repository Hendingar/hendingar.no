import { schemaDateTime } from '@hendingar/core/datetime';
import { parseFixture } from '@hendingar/core/fixture';
import { classifyEventKind } from '@hendingar/core/standing';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import { plainText } from '@hendingar/core/text';

/**
 * The structured data we publish about ourselves.
 *
 * `@hendingar/core/schemaorg` is the mirror of this and does the opposite: it *reads* schema.org
 * out of other people's pages when somebody pastes a link. This writes ours. They stay apart
 * because reading is shared with `importers/` and writing is only ever the app's job.
 *
 * Pure functions returning plain objects, so what we claim about an event is unit-testable rather
 * than only inspectable by pasting a URL into Google's Rich Results Test.
 *
 * ## What was wrong with the old block
 *
 * It lived inline in the event page and, on the live site, said this:
 *
 *     "url": "https://sunnhordland.museum.no/events/sunnhordland-escape-3/"
 *
 * on a page whose `rel=canonical` pointed at hendingar.no. Two contradictory answers to "where
 * does this event live", one of them telling Google the content is somebody else's. The outbound
 * link belongs in `offers.url` and the source page in `sameAs`; `url` and `@id` are us.
 */

/** A JSON-LD node. Values are whatever schema.org allows, which is not a type we can narrow. */
export type JsonLd = Record<string, unknown>;

export type EventForJsonLd = {
	title: string;
	description: string | null;
	category: CategorySlug;
	startsAt: Date;
	endsAt: Date | null;
	posterUrl: string | null;
	ctaUrl: string | null;
	sourceUrl: string | null;
	organizerName: string | null;
	venueName: string | null;
	venueAddress: string | null;
	venuePostalCode: string | null;
	venueMunicipality: string | null;
	venueLatitude: number | null;
	venueLongitude: number | null;
	venueTimeZone: string | null;
	/** Who it is for, as the source states it. Both null means everyone, or unstated. */
	ageFrom: number | null;
	ageTo: number | null;
	/** Every source that reported it — each one's own page for this event. */
	reportedBy: readonly { eventUrl: string | null }[];
};

const CONTEXT = 'https://schema.org';

/**
 * The schema.org subtype each category is, where one exists that is plainly the same thing.
 *
 * Google accepts every `Event` subtype for the event result, and the subtype is the cheapest true
 * thing we can add: the category is already ours, so this states nothing we have not decided.
 * Where no subtype fits without stretching — a church service, a meeting, a market, a "show" —
 * it stays `Event`. `SaleEvent` reads like a julemarknad and means a shop's discount weekend.
 */
const EVENT_TYPE: Record<CategorySlug, string> = {
	musikk: 'MusicEvent',
	teater: 'TheaterEvent',
	utstilling: 'ExhibitionEvent',
	sport: 'SportsEvent',
	mote: 'Event',
	kyrkjeliv: 'Event',
	festival: 'Festival',
	litteratur: 'LiteraryEvent',
	'stand-up': 'ComedyEvent',
	show: 'Event',
	kino: 'ScreeningEvent',
	'mat-og-drikke': 'FoodEvent',
	dans: 'DanceEvent',
	marknad: 'Event',
	konferanse: 'BusinessEvent',
	kurs: 'EducationEvent',
	anna: 'Event'
};

/**
 * One event, as `schema.org/Event` — or null for a row that is not one.
 *
 * `canonical` is the absolute URL of our own page for it. Everything derived from it — `@id`,
 * `url`, the image fallback — is that one string, so the page cannot disagree with itself.
 *
 * ## Why a standing row gets nothing
 *
 * A weekly activity or an open-all-season place is stored with the span of its season, and on the
 * live site that published Familiebading as one event from 2018-01-20 to 2030-12-20. Google's
 * event guidelines name exactly this — a long time period marked up as a single event — as
 * something not to do, and it is not a claim we would make to a reader either: the page itself
 * shows a timetable, not a start time (ADR 0013, ADR 0021). The rule is `classifyEventKind`, the
 * same one the generated `events.kind` column is built from, so markup and listings cannot
 * disagree about which rows are events. The breadcrumb still describes the page.
 */
export function eventJsonLd(event: EventForJsonLd, canonical: string): JsonLd | null {
	if (classifyEventKind(event.startsAt, event.endsAt) === 'standing') return null;

	const description = plainText(event.description);
	const fixture = parseFixture(event.title);
	const ageRange = typicalAgeRange(event.ageFrom, event.ageTo);
	const teams = fixture
		? [fixture.home, fixture.away].map((side) => ({
				'@type': 'SportsTeam',
				name: side.grade ? `${side.club} ${side.grade}` : side.club
			}))
		: null;

	/*
	 * Every other page that describes this same event: the source's own listing, plus the listings
	 * of any other calendar that reported it. `sameAs` is exactly the right word for that, and it
	 * is a claim we can make honestly because consolidation already established they are one event.
	 */
	const sameAs = [
		...new Set([event.sourceUrl, ...event.reportedBy.map((r) => r.eventUrl)].filter(isUrl))
	].filter((url) => url !== canonical);

	return {
		'@context': CONTEXT,
		/*
		 * A fixture is a match whatever category its source filed it under, so the title's
		 * evidence wins over the category's.
		 */
		'@type': fixture ? 'SportsEvent' : EVENT_TYPE[event.category],
		'@id': canonical,
		url: canonical,
		/*
		 * Decoded, for the same reason `description` is and with the same net-under-the-importers
		 * argument `@hendingar/core/text` records: a source that hands us an entity-encoded title
		 * puts it into every machine-readable surface at once. Moster Amfi's `Viser, Historie og
		 * Humor &laquo;…&raquo;` was live in this field — `importers/mec` did no decoding at all,
		 * and the `plainText` pass every description gets was never applied to the name.
		 *
		 * Falling back to the raw title rather than dropping the field: `plainText` returns null
		 * for a string that is entirely markup, and an `Event` with no `name` is worse than an
		 * `Event` with an ugly one.
		 */
		name: plainText(event.title) ?? event.title,
		/*
		 * The venue's offset, not UTC. Google asks for an offset, and a consumer that ignores one
		 * still reads the right wall clock — which `18:00Z` for a 20:00 Oslo concert does not give
		 * them. See schemaDateTime.
		 */
		startDate: schemaDateTime(event.startsAt, event.venueTimeZone),
		...(event.endsAt ? { endDate: schemaDateTime(event.endsAt, event.venueTimeZone) } : {}),
		/*
		 * Constants, because we have no column that could vary them and guessing is worse than
		 * silence. Google treats a missing `eventStatus` as scheduled anyway; saying so explicitly
		 * is what lets a future cancellation be a change rather than an addition.
		 */
		eventStatus: `${CONTEXT}/EventScheduled`,
		eventAttendanceMode: `${CONTEXT}/OfflineEventAttendanceMode`,
		inLanguage: 'nn',
		...(description ? { description } : {}),
		/*
		 * Our own share card when the source gave no poster. Every published event has one at
		 * `<page>/og.png` — 1200×630, its title, date and place — and it is the image a shared link
		 * already shows, so this is the same picture we stand behind everywhere else rather than a
		 * new claim. Search Console counted 22 events with no `image` before this.
		 */
		image: [event.posterUrl ?? `${canonical}/og.png`],
		...(event.venueName ? { location: placeNode(event) } : {}),
		...(ageRange ? { typicalAgeRange: ageRange } : {}),
		/*
		 * The two sides, when the title is a fixture. `competitor` rather than `homeTeam` and
		 * `awayTeam`: `importers/fotball` deliberately does not decide which side is at home, and
		 * the order NFF wrote them in is not evidence of it. `performer` is what Google's event
		 * result reads, and for a match the teams are what performs. Every other event still has
		 * no performer — we hold no line-up, and a guessed one is worse than the warning.
		 */
		...(teams ? { competitor: teams, performer: teams } : {}),
		...(event.organizerName
			? { organizer: { '@type': 'Organization', name: event.organizerName } }
			: {}),
		/*
		 * The ticket or booking link, as an Offer — which is where Google looks for "a link the user
		 * could click". No price: we store none, and inventing `0` would claim events are free.
		 */
		...(isUrl(event.ctaUrl)
			? { offers: { '@type': 'Offer', url: event.ctaUrl, availability: `${CONTEXT}/InStock` } }
			: {}),
		...(sameAs.length > 0 ? { sameAs } : {})
	};
}

/**
 * schema.org's own form: `"8-10"`, or open-ended `"16-"`. A band with only an upper bound starts
 * at zero, which is how `fitsAgeBand` already reads it.
 */
function typicalAgeRange(from: number | null, to: number | null): string | null {
	if (from === null && to === null) return null;
	return `${from ?? 0}-${to ?? ''}`;
}

function placeNode(event: EventForJsonLd): JsonLd {
	return {
		'@type': 'Place',
		name: event.venueName,
		/*
		 * `location.address` is REQUIRED for Google's Event rich result, and it is now always
		 * written — which is a deliberate change from "only when we know a street or a
		 * municipality".
		 *
		 * The reasoning it replaces was that an empty PostalAddress asserts we know the address and
		 * that it is nothing. That objection stands, and this is not that: `addressCountry: 'NO'` is
		 * the one part of the address we know for every row in the database, because every source
		 * here is a Norwegian local calendar. A true partial address is not an empty one.
		 *
		 * It is still thin, and worth being honest about what it buys: Search Console stops
		 * reporting `Missing field "address"` on 11 items, but a country is not what helps somebody
		 * find the hall. The fix that does is a real `addressLocality` — which is a data problem,
		 * not a markup one. `venues.geocode_status` is `pending` for essentially every row, and the
		 * importers that could guess a municipality deliberately do not: allevents.in files a hall
		 * in Sagvåg under "Ølen", and a postal town ("5430 Svortland") is not a municipality
		 * (Bømlo). Geocoding those rows properly is what turns this field from valid into useful.
		 */
		address: {
			'@type': 'PostalAddress',
			...(event.venueAddress ? { streetAddress: event.venueAddress } : {}),
			...(event.venuePostalCode ? { postalCode: event.venuePostalCode } : {}),
			...(event.venueMunicipality ? { addressLocality: event.venueMunicipality } : {}),
			addressCountry: 'NO'
		},
		...(event.venueLatitude !== null && event.venueLongitude !== null
			? {
					geo: {
						'@type': 'GeoCoordinates',
						latitude: event.venueLatitude,
						longitude: event.venueLongitude
					}
				}
			: {})
	};
}

/**
 * Where this page sits. Google renders it as the trail under a result instead of the raw URL.
 *
 * Positions are 1-based and must be contiguous, so the caller passes the whole trail including
 * the page itself.
 */
export function breadcrumbJsonLd(trail: readonly { name: string; url: string }[]): JsonLd {
	return {
		'@context': CONTEXT,
		'@type': 'BreadcrumbList',
		itemListElement: trail.map((step, index) => ({
			'@type': 'ListItem',
			position: index + 1,
			name: step.name,
			item: step.url
		}))
	};
}

/**
 * The site itself, once, on the front page.
 *
 * `areaServed` names the municipalities we actually cover rather than the ambition in the README.
 * Every imported event in the database is Sunnhordland; claiming Bergen would be a claim we cannot
 * currently back with a single row.
 */
export function siteJsonLd(origin: string): JsonLd {
	return {
		'@context': CONTEXT,
		'@graph': [
			{
				'@type': 'WebSite',
				'@id': `${origin}/#website`,
				url: origin,
				name: 'hendingar.no',
				inLanguage: 'nn',
				publisher: { '@id': `${origin}/#organization` }
			},
			{
				'@type': 'Organization',
				'@id': `${origin}/#organization`,
				name: 'hendingar.no',
				url: origin,
				description:
					'Hendingar frå lokale kalendrar i Sunnhordland, samla i éi liste. Open kjeldekode, ingen reklame.',
				areaServed: ['Stord', 'Bømlo', 'Fitjar', 'Sunnhordland'].map((name) => ({
					'@type': 'AdministrativeArea',
					name
				}))
			}
		]
	};
}

/**
 * A listing, as an ordered list of the pages it links to.
 *
 * Not for a rich result — Google grants the Event card only to pages about a single event. This is
 * so a crawler reading `/hendingar` or a day page is told, in one place, that it is looking at a
 * list of events and where each one lives.
 */
export function itemListJsonLd(name: string, urls: readonly string[]): JsonLd {
	return {
		'@context': CONTEXT,
		'@type': 'ItemList',
		name,
		numberOfItems: urls.length,
		itemListElement: urls.map((url, index) => ({
			'@type': 'ListItem',
			position: index + 1,
			url
		}))
	};
}

/** http(s) only, and only when there is something there. Guards every URL that leaves this file. */
function isUrl(value: string | null | undefined): value is string {
	if (!value) return false;
	try {
		return /^https?:$/.test(new URL(value).protocol);
	} catch {
		return false;
	}
}

/**
 * Ready for a `<script type="application/ld+json">`.
 *
 * `</` cannot appear inside a script element, and a description quoting `</p>` would otherwise
 * close the tag early and spill JSON into the document — the one genuinely dangerous thing about
 * embedding data this way. Escaping only `</` was not quite enough: a title holding `<!--<script>`
 * moves the HTML parser into its "double-escaped" state, which swallows the page after it.
 *
 * So every `<`, `>` and `&` becomes its `\u` escape, which JSON reads back as the same character
 * and HTML never sees at all. U+2028 and U+2029 likewise, the two characters that are valid in JSON
 * and were, until recently, line terminators in JavaScript.
 */
export function jsonLdScript(node: JsonLd): string {
	return JSON.stringify(node)
		.replace(/</g, '\\u003c')
		.replace(/>/g, '\\u003e')
		.replace(/&/g, '\\u0026')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}
