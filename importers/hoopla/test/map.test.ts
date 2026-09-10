import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { formatEventTime } from '@hendingar/core/datetime';
import { MAX_DETAILS, parseDetail, parseEvents, type UpstreamEvent } from '../src/api.ts';
import {
	SHOPS,
	eventDetailUrl,
	eventUrl,
	eventsUrl,
	listingUrl,
	shopBySlug,
	type HooplaShop
} from '../src/shops.ts';
import {
	addressOf,
	categoryOf,
	describe as describeEvent,
	isFailure,
	isPublishable,
	mapEvent,
	posterUrlOf,
	slugifyVenue,
	venueNameOf
} from '../src/map.ts';

/**
 * Against committed real responses. No network, no clock (CLAUDE.md rule 6).
 *
 * Captured from `smaasceneri.hoopla.no/api/public/v3.0/organizations/254371621/…` on 2026-09-10
 * and stored verbatim, so a change in the upstream shape shows up as a diff here rather than as an
 * empty listing in production.
 */
const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

/**
 * A function rather than `const SHOP = SHOPS[0]` plus a narrowing `throw`.
 *
 * `noUncheckedIndexedAccess` types the index access as `HooplaShop | undefined`, and a top-level
 * `if (!SHOP) throw` does not narrow it inside the hoisted `function` helpers below — those could,
 * as far as the compiler is concerned, run first.
 */
function firstShop(): HooplaShop {
	const shop = SHOPS[0];
	if (!shop) throw new Error('the fixtures describe Småsceneri; SHOPS must not be empty');
	return shop;
}

const SHOP = firstShop();

const LIST = 'smaasceneri-events.json';

function rows(): UpstreamEvent[] {
	return parseEvents(fixture(LIST)).rows;
}

function only(eventId: number): UpstreamEvent {
	const found = rows().find((e) => e.event_id === eventId);
	if (!found) throw new Error(`${eventId} is not in ${LIST}`);
	return found;
}

function mapped(eventId: number) {
	const result = mapEvent(only(eventId), SHOP);
	if (isFailure(result)) throw new Error(`${eventId} did not map: ${result.problem}`);
	return result;
}

describe('parseEvents', () => {
	it('reads every event in the committed response', () => {
		expect(rows()).toHaveLength(4);
	});

	it('rejects nothing in a real response', () => {
		// If this starts failing, the schema and the API have parted company — which is the whole
		// reason the fixture is committed rather than synthesised.
		expect(parseEvents(fixture(LIST)).rejected).toEqual([]);
	});

	it('throws when the envelope is not an events response', () => {
		// An error document parsed as an empty shop is indistinguishable from a shop that emptied,
		// and the second is a thing that legitimately happens. A Queue-It challenge page reaching
		// this function must be the loud kind of failure.
		expect(() => parseEvents({ error: 'nope' })).toThrow(/unexpected events shape/);
		expect(() => parseEvents('<html>queue</html>')).toThrow(/unexpected events shape/);
	});

	it('reports a malformed row instead of dropping it', () => {
		const { rows: parsed, rejected } = parseEvents({
			events: [{ event_id: 1, name: 'Utan tid', data: {} }]
		});
		expect(parsed).toEqual([]);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]).toContain('start');
	});

	it('refuses a start that is a string but not a date', () => {
		const { rejected } = parseEvents({
			events: [{ event_id: 1, name: 'Snart', start: 'neste torsdag', data: {} }]
		});
		expect(rejected[0]).toContain('not a parseable instant');
	});

	it('tolerates an event whose data carries no images block', () => {
		// Event 698512154 really is like this upstream: no `data.images` at all, while the
		// top-level `images` is fully populated. It is the reason map.ts reads the flat one.
		const row = only(698512154);
		expect(row.images?.crop16x9?.url).toBeTruthy();
		expect(posterUrlOf(row)).toContain('twic.pics');
	});
});

describe('the times, which are instants and were checked as such', () => {
	/*
	 * The DST cross-check CLAUDE.md demands, and the reason this source is trusted where MEC is
	 * not. Two events in the same series, both of which tell a human "showstart kl 21:00" in their
	 * own description, on opposite sides of the October clock change:
	 *
	 *   11 Sep (CEST, +02): start 19:00Z
	 *   06 Nov (CET,  +01): start 20:00Z
	 *
	 * The raw UTC differs by an hour precisely so the local clock does not. An offset-adder of the
	 * MEC kind would have written 19:00 for both, and this test would fail — which is exactly what
	 * it is for.
	 */
	it('renders 21:00 in Oslo on both sides of the clock change', () => {
		for (const id of [174397646, 698512154]) {
			const at = formatEventTime(mapped(id).startsAt, 'Europe/Oslo');
			expect(at, String(id)).toContain('21');
		}
	});

	it('agrees with the door and show times the description states', () => {
		const detail = parseDetail(fixture('smaasceneri-event-174397646.json'));
		expect(detail).toContain('showstart kl 21:00');
		expect(mapped(174397646).startsAt.toISOString()).toBe('2026-09-11T19:00:00.000Z');
	});

	it('keeps the end time as stated', () => {
		expect(mapped(174397646).endsAt?.toISOString()).toBe('2026-09-11T21:00:00.000Z');
	});

	it('drops an end that precedes its start, and keeps the event', () => {
		const backwards: UpstreamEvent = {
			...only(174397646),
			end: '2026-09-11T18:00:00Z'
		};
		const result = mapEvent(backwards, SHOP);
		if (isFailure(result)) throw new Error('the event should survive a bad end time');
		expect(result.endsAt).toBeNull();
		expect(result.startsAt.toISOString()).toBe('2026-09-11T19:00:00.000Z');
	});

	it('gives the venue a zone rather than an offset', () => {
		expect(mapped(174397646).venueTimezone).toBe('Europe/Oslo');
		for (const shop of SHOPS) expect(shop.timezone).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$/);
	});
});

describe('mapEvent', () => {
	it('keys on the event id alone, so a re-timed event updates in place', () => {
		const before = mapped(174397646);
		const moved = mapEvent({ ...only(174397646), start: '2026-09-12T19:00:00Z' }, SHOP);
		if (isFailure(moved)) throw new Error('a re-timed event should still map');
		// The whole point: correcting a time must not mint a second key and abandon the first row.
		expect(moved.externalId).toBe(before.externalId);
		expect(before.externalId).toBe('174397646');
	});

	it('gives every event in the fixture a distinct key', () => {
		const ids = rows()
			.map((e) => mapEvent(e, SHOP))
			.map((m) => (isFailure(m) ? null : m.externalId));
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('links to the event, not to the shop', () => {
		expect(mapped(174397646).sourceUrl).toBe('https://smaasceneri.hoopla.no/event/174397646');
	});

	it('refuses an event with no title', () => {
		const result = mapEvent({ ...only(174397646), name: '   ' }, SHOP);
		expect(isFailure(result)).toBe(true);
	});

	it('does not name the source page twice', () => {
		// On Hoopla "read more" and "buy a ticket" are one URL; naming it as both would render two
		// identical buttons.
		expect(mapped(174397646).ctaUrl).toBeNull();
	});

	it('hotlinks the image without claiming rights to it', () => {
		const m = mapped(174397646);
		expect(m.posterUrl).toBe(
			'https://hoopla.twic.pics/production/254371621/Logo.1786472946.jpg?twic=v1/output=auto'
		);
		expect(m.posterRightsVerified).toBe(false);
	});

	it('leaves the poster null when the payload has no image', () => {
		expect(posterUrlOf({ ...only(174397646), images: null })).toBeNull();
	});

	it('leaves a venue unlocated when the payload carries no coordinate', () => {
		// True of every row in this fixture, and the reason we do not geocode: address.ts records
		// Kartverket getting four of sixteen Sunnhordland venues actively wrong.
		const m = mapped(174397646);
		expect(m.latitude).toBeNull();
		expect(m.longitude).toBeNull();
	});

	it('carries a coordinate the source does assert', () => {
		const withCoords = structuredClone(only(174397646));
		withCoords.data.location = {
			...withCoords.data.location,
			coordinates: { latitude: 59.78, longitude: 5.5 }
		};
		const m = mapEvent(withCoords, SHOP);
		if (isFailure(m)) throw new Error('should map');
		expect(m.latitude).toBe(59.78);
	});

	it('leaves the description to ingest, which reads the event page', () => {
		// The list carries no prose at all — `short_description` is null on every row.
		expect(mapped(174397646).description).toBeNull();
	});
});

describe('the venue name, and the one room spelled two ways', () => {
	/*
	 * The bug this normalisation exists for. Both of these are Vikjoscenen, Torget 10, and left
	 * alone they slugify apart into two `venues` rows for one room.
	 */
	it('resolves both spellings of Vikjoscenen to the same venue', () => {
		const a = mapped(983124565);
		const b = mapped(1507533914);
		expect(a.venueName).toBe('Vikjoscenen');
		expect(b.venueName).toBe('Vikjoscenen');
		expect(a.venueSlug).toBe(b.venueSlug);
	});

	it('still keeps the street, in the column the street belongs in', () => {
		const m = mapped(983124565);
		expect(m.venueAddress.street).toBe('Torget 10');
		expect(m.venueAddress.postalCode).toBe('5417');
	});

	it('leaves a name that does not contain its street completely alone', () => {
		expect(venueNameOf(only(174397646))).toBe('Gruo pub');
		expect(venueNameOf(only(698512154))).toBe('Den Blå Time');
	});

	it('keeps the name when the street is all there is to it', () => {
		// Stripping would leave nothing, and a venue with no name is worse than one named after
		// the door it is behind.
		const row = structuredClone(only(174397646));
		row.data.location = { name: 'Torget 10', street_address: 'Torget 10' };
		expect(venueNameOf(row)).toBe('Torget 10');
	});

	it('does not let a street with regex punctuation match something else', () => {
		const row = structuredClone(only(174397646));
		row.data.location = { name: 'Kaien (nord) 3 — Storsalen', street_address: 'Kaien (nord) 3' };
		expect(venueNameOf(row)).toBe('Storsalen');
	});

	it('returns nothing when the source names no venue', () => {
		const row = structuredClone(only(174397646));
		row.data.location = null;
		expect(venueNameOf(row)).toBeNull();
		const m = mapEvent(row, SHOP);
		if (isFailure(m)) throw new Error('an event with no venue is still an event');
		expect(m.venueSlug).toBeNull();
	});

	it('refuses to call a post town a municipality', () => {
		// `5410 Sagvåg` is a village in Stord. coverage.ts knows that; a `municipality` column
		// filled from this field would simply be wrong.
		const address = addressOf(only(174397646));
		expect(address.city).toBe('Sagvåg');
		expect(address.street).toBe('Sagvågsbrekko 6');
	});
});

describe('categoryOf', () => {
	it('maps the vocabulary Hoopla actually sends', () => {
		expect(categoryOf(only(174397646))).toBe('show');
	});

	it('maps every value in Hoopla’s own list to a real category', () => {
		const hoopla = [
			'CONCERT',
			'CONFERENCE',
			'FESTIVAL',
			'SEMINAR',
			'COURSE',
			'SHOW',
			'SPORTS',
			'EXHIBITION',
			'GATHERING',
			'OTHER'
		];
		for (const raw of hoopla) {
			const slug = categoryOf({ ...only(174397646), data: { category: raw } });
			expect(CATEGORY_SLUGS, raw).toContain(slug);
		}
	});

	it('files an unknown or absent category as anna rather than failing the event', () => {
		// A vocabulary somebody else owns must not be able to reject a whole event by growing.
		expect(categoryOf({ ...only(174397646), data: { category: 'BINGO' } })).toBe('anna');
		expect(categoryOf({ ...only(174397646), data: { category: null } })).toBe('anna');
	});

	it('does not read a category out of the title', () => {
		// Every fixture event is improvised theatre and says so; Hoopla has no theatre category,
		// so `teater` is not something this source can tell us.
		expect(mapped(174397646).title).toContain('Improteater');
		expect(mapped(174397646).category).toBe('show');
	});
});

describe('isPublishable', () => {
	it('takes every event in the fixture', () => {
		expect(rows().filter(isPublishable)).toHaveLength(4);
	});

	it('drops a cancelled event', () => {
		expect(isPublishable({ ...only(174397646), is_cancelled: true })).toBe(false);
	});

	it('keeps a sold-out one', () => {
		// Sold out is a fact about tickets, not about whether the thing is happening. We are an
		// index, not a ticket counter.
		const soldOut = { ...only(174397646), availability: 'SOLD_OUT', sale_state: 'ended' };
		expect(isPublishable(soldOut)).toBe(true);
	});
});

describe('parseDetail', () => {
	it('reads the description out of every committed detail response', () => {
		for (const id of [174397646, 698512154, 983124565, 1507533914]) {
			const text = parseDetail(fixture(`smaasceneri-event-${id}.json`));
			expect(text, String(id)).toBeTruthy();
		}
	});

	it('keeps the paragraph breaks the organiser typed', () => {
		const text = describeEvent(parseDetail(fixture('smaasceneri-event-983124565.json')));
		expect(text).toContain('Workshopstart kl. 18:00');
		expect(text).toContain('\n');
	});

	it('returns null rather than throwing when the detail shape moves', () => {
		// A supplement: a changed detail response must cost a description, never an event.
		expect(parseDetail({ nope: true })).toBeNull();
		expect(parseDetail('<html>queue</html>')).toBeNull();
		expect(parseDetail({ event: { description: '   ' } })).toBeNull();
	});

	it('is safe on text that was never markup, and on text that is', () => {
		expect(describeEvent('Rein tekst')).toBe('Rein tekst');
		expect(describeEvent('<p>Hallo</p><p>Verda</p>')).toBe('Hallo\n\nVerda');
	});
});

describe('the shop registry', () => {
	it('prefixes every slug so /kjelder groups it under Hoopla', () => {
		for (const shop of SHOPS) expect(shop.slug.startsWith('hoopla-')).toBe(true);
	});

	it('holds an organization id, because the subdomain is not enough', () => {
		for (const shop of SHOPS) expect(shop.organizationId).toMatch(/^\d+$/);
	});

	it('finds a shop by slug and nothing by a made-up one', () => {
		expect(shopBySlug('hoopla-smaasceneri')?.name).toBe('Småsceneri');
		expect(shopBySlug('hoopla-nope')).toBeUndefined();
	});

	it('builds the endpoint the fixture was captured from', () => {
		expect(eventsUrl(SHOP)).toBe(
			'https://smaasceneri.hoopla.no/api/public/v3.0/organizations/254371621/events'
		);
		expect(eventDetailUrl(SHOP, 174397646)).toBe(
			'https://smaasceneri.hoopla.no/api/public/v3.0/organizations/254371621/events/174397646'
		);
	});

	it('builds reader-facing URLs on the shop’s own host', () => {
		expect(listingUrl(SHOP)).toBe('https://smaasceneri.hoopla.no/');
		expect(eventUrl(SHOP, 1)).toBe('https://smaasceneri.hoopla.no/event/1');
	});

	it('budgets detail requests, so a large shop cannot spin', () => {
		expect(MAX_DETAILS).toBeGreaterThan(rows().length);
	});
});

describe('slugifyVenue', () => {
	it('folds Norwegian letters rather than dropping them', () => {
		expect(slugifyVenue('Den Blå Time')).toBe('den-blaa-time');
		expect(slugifyVenue('Sagvåg Kyrkje')).toBe('sagvaag-kyrkje');
	});

	it('produces one stable slug per venue', () => {
		expect(slugifyVenue('Vikjoscenen Stord')).toBe(slugifyVenue('  Vikjoscenen   Stord  '));
	});
});
