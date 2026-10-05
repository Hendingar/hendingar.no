import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatEventClock, instantToZonedWallClock } from '@hendingar/core/datetime';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { parseListing, slugOf, type Listing } from '../src/api.ts';
import { SHOPS, shopBySlug } from '../src/instances.ts';
import {
	DEFAULT_CATEGORY,
	eventId,
	isCancelled,
	isFailure,
	mapEvent,
	readWallClock,
	type MappedEvent
} from '../src/map.ts';

/**
 * Against a committed real shop page, and two of TicketCo's own `.ics` files for events on it.
 * No network, no clock (CLAUDE.md rule 6).
 */
const fixture = (name: string) =>
	readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const frugard = shopBySlug('ticketco-frugard')!;
const listing = parseListing(fixture('frugard-shop.html'));

const find = (slug: string) => listing.listings.find((l) => l.slug === slug)!;

function mapOne(entry: Listing): MappedEvent {
	const mapped = mapEvent(entry.event, entry.slug, entry.card, frugard);
	if (isFailure(mapped)) throw new Error(`${mapped.title}: ${mapped.problem}`);
	return mapped;
}

/** `DTSTART;TZID=Europe/Oslo:20261023T183000` → the zone and the wall clock it states. */
function icsStart(ics: string): { zone: string; date: string; time: string } {
	const match = /^DTSTART;TZID=([^:]+):(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/m.exec(ics);
	if (!match) throw new Error('no DTSTART in fixture');
	const [, zone, y, mo, d, h, mi] = match;
	return { zone: zone!, date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

describe('parseListing', () => {
	it('finds all nine events, and every one validates', () => {
		expect(listing.listings).toHaveLength(9);
		expect(listing.rejected).toEqual([]);
	});

	it("reads the single-quoted <script type='application/ld+json'> blocks", () => {
		// The page quotes the attribute with `'`. A pattern that expects `"` finds no events at all.
		expect(fixture('frugard-shop.html')).toContain("<script type='application/ld+json'>");
		expect(listing.listings[0]!.event.name).toContain('Erlend Loe');
	});

	it('pairs every JSON-LD block with the card that prints the same event', () => {
		for (const entry of listing.listings) {
			expect(entry.slug, entry.event.name).not.toBeNull();
			expect(entry.card, entry.event.name).not.toBeNull();
		}
		expect(find('rammsund_2026').card).toEqual({ date: '2026-10-24', time: '20:00' });
	});

	it('pairs across the language mismatch between the card and the JSON-LD', () => {
		// The card links `/no/nb/m/e/rammsund_2026`, the JSON-LD `/no/en/e/rammsund_2026`.
		expect(find('rammsund_2026').event.url).toBe(
			'https://frugard.ticketco.events/no/en/e/rammsund_2026'
		);
	});
});

describe('slugOf', () => {
	it('reads the slug whichever language and layout the URL is in', () => {
		expect(slugOf('https://frugard.ticketco.events/no/en/e/open_arena')).toBe('open_arena');
		expect(slugOf('https://frugard.ticketco.events/no/nb/m/e/open_arena')).toBe('open_arena');
		expect(slugOf('https://frugard.ticketco.events/no/nb/e/open_arena?version=m')).toBe(
			'open_arena'
		);
	});

	it('refuses a URL that is not an event', () => {
		expect(slugOf('https://frugard.ticketco.events/no/nb/m')).toBeNull();
		expect(slugOf('not a url')).toBeNull();
		expect(slugOf(null)).toBeNull();
	});
});

describe('the clock: TicketCo writes Oslo wall time and labels it UTC', () => {
	it('reads the digits and ignores the offset', () => {
		expect(readWallClock('2026-10-23T18:30:00Z')).toEqual({ date: '2026-10-23', time: '18:30' });
		expect(readWallClock('2026-10-23T18:30:00+02:00')).toEqual({
			date: '2026-10-23',
			time: '18:30'
		});
		expect(readWallClock('2026-02-31T18:30:00Z')).toBeNull();
		expect(readWallClock('soon')).toBeNull();
	});

	it("puts Erlend Loe at 18:30 in Stord, in summer time — not the JSON-LD's 20:30", () => {
		const entry = find('erlend_loe_les_kukenekukane_live');
		expect(entry.event.startDate).toBe('2026-10-23T18:30:00Z');

		const mapped = mapOne(entry);
		expect(formatEventClock(mapped.startsAt, 'Europe/Oslo')).toBe('18:30');
		expect(mapped.startsAt.toISOString()).toBe('2026-10-23T16:30:00.000Z');
		expect(mapped.endsAt?.toISOString()).toBe('2026-10-23T20:00:00.000Z');
	});

	it('puts SLOMOSA at 20:00 in Stord, in winter time — the offset is not a seasonal accident', () => {
		const mapped = mapOne(find('slomosa'));
		expect(find('slomosa').event.startDate).toBe('2027-01-08T20:00:00Z');
		expect(formatEventClock(mapped.startsAt, 'Europe/Oslo')).toBe('20:00');
		expect(mapped.startsAt.toISOString()).toBe('2027-01-08T19:00:00.000Z');
	});

	it("agrees with TicketCo's own .ics for the same events", () => {
		// The third independent statement from the source, and the one written for calendars.
		for (const [file, slug] of [
			['frugard-event-1080734.ics', 'erlend_loe_les_kukenekukane_live'],
			['frugard-event-1205837.ics', 'slomosa']
		] as const) {
			const ics = icsStart(fixture(file));
			const mapped = mapOne(find(slug));
			expect(instantToZonedWallClock(mapped.startsAt, ics.zone), slug).toEqual({
				date: ics.date,
				time: ics.time
			});
		}
	});

	it('every stored start shows the clock its card prints', () => {
		for (const entry of listing.listings) {
			const mapped = mapOne(entry);
			expect(instantToZonedWallClock(mapped.startsAt, 'Europe/Oslo'), entry.event.name).toEqual(
				entry.card
			);
			expect(mapped.clockDisagreement, entry.event.name).toBeNull();
		}
	});

	it('prefers the printed card where the two disagree, and says so', () => {
		const entry = find('rammsund_2026');
		const mapped = mapEvent(
			entry.event,
			entry.slug,
			{ date: '2026-10-24', time: '21:00' },
			frugard
		);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(formatEventClock(mapped.startsAt, 'Europe/Oslo')).toBe('21:00');
		expect(mapped.clockDisagreement).toContain('2026-10-24T20:00:00Z');
	});

	it('falls back to the JSON-LD clock, read the same way, when no card was found', () => {
		const entry = find('rammsund_2026');
		const mapped = mapEvent(entry.event, entry.slug, null, frugard);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(formatEventClock(mapped.startsAt, 'Europe/Oslo')).toBe('20:00');
		expect(mapped.clockDisagreement).toBeNull();
	});

	it('drops an end that is not after the start', () => {
		const entry = find('rammsund_2026');
		const mapped = mapEvent(
			{ ...entry.event, endDate: entry.event.startDate },
			entry.slug,
			entry.card,
			frugard
		);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.endsAt).toBeNull();
	});
});

describe('mapEvent', () => {
	it('keys on the slug and the day at the venue, never the instant', () => {
		expect(mapOne(find('rammsund_2026')).externalId).toBe('rammsund_2026@2026-10-24');
		expect(eventId('slomosa', '2027-01-08')).toBe('slomosa@2027-01-08');
	});

	it('keeps the same id when the time is corrected', () => {
		// The whole point of keying on the day: a re-timed event updates in place.
		const entry = find('rammsund_2026');
		const at20 = mapEvent(entry.event, entry.slug, { date: '2026-10-24', time: '20:00' }, frugard);
		const at21 = mapEvent(entry.event, entry.slug, { date: '2026-10-24', time: '21:00' }, frugard);
		if (isFailure(at20) || isFailure(at21)) throw new Error('unmapped');
		expect(at21.externalId).toBe(at20.externalId);
		expect(+at21.startsAt).not.toBe(+at20.startsAt);
	});

	it('links every event to its own page, in Norwegian, whatever language the JSON-LD used', () => {
		for (const entry of listing.listings) {
			const mapped = mapOne(entry);
			expect(mapped.sourceUrl).toBe(`https://frugard.ticketco.events/no/nb/e/${entry.slug}`);
		}
	});

	it('trims and decodes the title, and turns the description into text', () => {
		const mapped = mapOne(find('rammsund_2026'));
		expect(mapped.title).toBe('RAMMSUND');
		expect(mapped.description).toContain('Dørene opnar kl 20');
		expect(mapped.description).not.toMatch(/<\/?p>|&nbsp;/);
	});

	it('imports as anna, which is a real category, because the source states none', () => {
		expect(CATEGORY_SLUGS).toContain(DEFAULT_CATEGORY);
		for (const entry of listing.listings) expect(mapOne(entry).category).toBe('anna');
	});

	it('hotlinks the poster without claiming the right to it', () => {
		const mapped = mapOne(find('slomosa'));
		expect(mapped.posterUrl).toMatch(/^https:\/\/tuploads\.s3\.amazonaws\.com\//);
		expect(mapped.posterRightsVerified).toBe(false);
		expect(mapped.ctaUrl).toBeNull();
	});

	it('refuses an event with no slug rather than inventing an identity', () => {
		const entry = find('slomosa');
		const mapped = mapEvent(entry.event, null, entry.card, frugard);
		expect(isFailure(mapped)).toBe(true);
	});
});

describe('isCancelled', () => {
	it('reads both spellings schema.org allows', () => {
		const event = find('slomosa').event;
		expect(isCancelled(event)).toBe(false);
		expect(isCancelled({ ...event, eventStatus: 'EventCancelled' })).toBe(true);
		expect(isCancelled({ ...event, eventStatus: 'https://schema.org/EventCancelled' })).toBe(true);
		expect(isCancelled({ ...event, eventStatus: 'EventPostponed' })).toBe(false);
	});
});

describe('SHOPS', () => {
	it('every slug is grouped under TicketCo on /kjelder', () => {
		for (const shop of SHOPS) expect(shop.slug.startsWith('ticketco-'), shop.slug).toBe(true);
	});

	it('every shop names its venue in full', () => {
		for (const shop of SHOPS) {
			expect(shop.venue.name.trim(), shop.slug).not.toBe('');
			expect(shop.venue.postalCode, shop.slug).toMatch(/^\d{4}$/);
		}
	});
});
