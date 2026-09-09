import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { parseItems, type UpstreamEntry } from '../src/api.ts';
import { CALENDARS, calendarBySlug, eventUrl, itemsUrl, listingUrl } from '../src/calendars.ts';
import { isFailure, isPublishable, mapEntry, slugifyVenue } from '../src/map.ts';

/**
 * Against committed real responses. No network, no clock (CLAUDE.md rule 6).
 *
 * Both fixtures were captured from `api.lu.ma/calendar/get-items` for Tech Cluster West on
 * 2026-09-09 and are stored verbatim, so a change in the upstream shape shows up as a diff here
 * rather than as an empty listing in production.
 */
const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

const TCW = CALENDARS[0];
if (!TCW) throw new Error('the fixtures describe Tech Cluster West; CALENDARS must not be empty');

function entries(name: string): UpstreamEntry[] {
	return parseItems(fixture(name)).rows;
}

function only(name: string, apiId: string): UpstreamEntry {
	const found = entries(name).find((e) => e.event.api_id === apiId);
	if (!found) throw new Error(`${apiId} is not in ${name}`);
	return found;
}

describe('parseItems', () => {
	it('reads every entry in the committed responses', () => {
		expect(entries('tcw-future.json')).toHaveLength(1);
		expect(entries('tcw-past.json')).toHaveLength(3);
	});

	it('rejects nothing in a real response', () => {
		// If this starts failing, the schema and the API have parted company — which is the whole
		// reason the fixtures are committed rather than synthesised.
		for (const name of ['tcw-future.json', 'tcw-past.json']) {
			expect(parseItems(fixture(name)).rejected, name).toEqual([]);
		}
	});

	it('throws when the envelope is not a get-items response', () => {
		// An error document parsed as an empty calendar is indistinguishable from a calendar that
		// emptied, and the second is a thing that legitimately happens.
		expect(() => parseItems({ error: 'nope' })).toThrow(/unexpected get-items shape/);
		expect(() => parseItems('not json at all')).toThrow(/unexpected get-items shape/);
	});

	it('reports a malformed row instead of dropping it', () => {
		const { rows, rejected } = parseItems({
			entries: [{ api_id: 'calev-1', event: { api_id: 'evt-1', name: 'Utan tid' } }]
		});
		expect(rows).toEqual([]);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]).toContain('start_at');
	});

	it('refuses a start_at that is a string but not a date', () => {
		const { rejected } = parseItems({
			entries: [
				{
					api_id: 'calev-1',
					event: { api_id: 'evt-1', name: 'Neste torsdag', start_at: 'neste torsdag' }
				}
			]
		});
		// `new Date('neste torsdag')` is Invalid Date, which would reach the database as null.
		expect(rejected[0]).toContain('not a parseable instant');
	});

	it('does not page forever on a stringified False', () => {
		/*
		 * The calendar page's embedded copy of this payload spells the booleans Python-style. A
		 * truthy `"False"` would make the paginator ask for page after page of the same thing.
		 */
		expect(parseItems({ entries: [], has_more: 'False' }).hasMore).toBe(false);
		expect(parseItems({ entries: [], has_more: 'True' }).hasMore).toBe(true);
		expect(parseItems({ entries: [], has_more: false }).hasMore).toBe(false);
	});
});

describe('mapEntry', () => {
	it('keeps the instant the API states, which the source also states to a human', () => {
		const mapped = mapEntry(only('tcw-future.json', 'evt-sFA6CXwIQiEje10'), TCW);
		if (isFailure(mapped)) throw new Error(mapped.problem);

		/*
		 * The cross-check CLAUDE.md asks for, written down as an assertion.
		 *
		 * The API says `2026-10-22T16:30:00.000Z`. The calendar page's own embedded schema.org says
		 * `"startDate":"2026-10-22T18:30:00.000+02:00"` and `"endDate":"…T20:30:00.000+02:00"`.
		 * Those are the same two instants, so unlike Modern Events Calendar this source is not
		 * adding an offset to a wall clock and then writing the offset it added.
		 */
		expect(mapped.startsAt.toISOString()).toBe('2026-10-22T16:30:00.000Z');
		expect(new Date('2026-10-22T18:30:00.000+02:00').getTime()).toBe(+mapped.startsAt);
		expect(mapped.endsAt?.toISOString()).toBe('2026-10-22T18:30:00.000Z');
		expect(new Date('2026-10-22T20:30:00.000+02:00').getTime()).toBe(+(mapped.endsAt ?? 0));
	});

	it('keys on the event id alone, so a re-timed event updates in place', () => {
		const entry = only('tcw-future.json', 'evt-sFA6CXwIQiEje10');
		const before = mapEntry(entry, TCW);
		const moved = mapEntry(
			{ ...entry, event: { ...entry.event, start_at: '2026-10-23T16:30:00.000Z' } },
			TCW
		);
		if (isFailure(before) || isFailure(moved)) throw new Error('should have mapped');

		// The bug CLAUDE.md records: a key derived from the time forks the row when the time is
		// corrected, leaving the wrong one published and beyond the reach of every later run.
		expect(moved.externalId).toBe(before.externalId);
		expect(moved.externalId).toBe('evt-sFA6CXwIQiEje10');
		expect(+moved.startsAt).not.toBe(+before.startsAt);
	});

	it('gives every event in the fixtures a distinct key', () => {
		/*
		 * The assumption the key rests on: Luma gives each occurrence its own `evt-…`. If Luma ever
		 * shares one id across a repeating series, this fails and `recurrence_id` — declared in
		 * api.ts for exactly this — is where to look.
		 */
		const ids = [...entries('tcw-future.json'), ...entries('tcw-past.json')].map(
			(e) => e.event.api_id
		);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('reads the Norwegian address, and refuses to call a post town a municipality', () => {
		// "Bremnes" is in the past fixture. It is in Bømlo and stopped being a municipality in 1963.
		const mapped = mapEntry(only('tcw-past.json', 'evt-Wi7VbTAeZWf59qJ'), TCW);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.venueAddress.city).toBe('Bremnes');
		// `MappedEvent` has nowhere to put a municipality, which is the point — see map.ts.
		expect(mapped).not.toHaveProperty('municipality');
	});

	it('parses street and postnummer out of the localised address line', () => {
		const mapped = mapEntry(only('tcw-future.json', 'evt-sFA6CXwIQiEje10'), TCW);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		// "Sæ 134, 5417 Stord, Norge"
		expect(mapped.venueAddress.street).toBe('Sæ 134');
		expect(mapped.venueAddress.postalCode).toBe('5417');
		expect(mapped.venueAddress.city).toBe('Stord');
		expect(mapped.venueName).toBe('Sæ 134');
	});

	it('takes a named place as the venue and still finds the street', () => {
		/*
		 * `geo_address_info.address` is whatever the organiser picked out of Google's autocomplete:
		 * a named place here, a street number on the event above. Both shapes are in the fixtures,
		 * so both are asserted — the field cannot be assumed to mean either one.
		 */
		const mapped = mapEntry(only('tcw-past.json', 'evt-Wi7VbTAeZWf59qJ'), TCW);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.venueName).toBe('Sams senter');
		// From "Sams senter, Bankbrekko 22, 5430 Bremnes, Norway" — the venue name is not the street.
		expect(mapped.venueAddress.street).toBe('Bankbrekko 22');
		expect(mapped.venueAddress.postalCode).toBe('5430');
	});

	it('leaves a venue unlocated when the payload carries no coordinate', () => {
		// The older rows have no `place_coordinate`. A missing coordinate must stay missing rather
		// than becoming a zero, which would put the venue in the Atlantic off Ghana.
		const mapped = mapEntry(only('tcw-past.json', 'evt-Wi7VbTAeZWf59qJ'), TCW);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.latitude).toBeNull();
		expect(mapped.longitude).toBeNull();
	});

	it('carries the coordinate the source asserts', () => {
		const mapped = mapEntry(only('tcw-future.json', 'evt-sFA6CXwIQiEje10'), TCW);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.latitude).toBeCloseTo(59.7874965, 5);
		expect(mapped.longitude).toBeCloseTo(5.4970419, 5);
	});

	it('links to the event, not to the calendar', () => {
		const mapped = mapEntry(only('tcw-future.json', 'evt-sFA6CXwIQiEje10'), TCW);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.sourceUrl).toBe('https://luma.com/ahupvg92');
		expect(mapped.sourceUrl).not.toBe(listingUrl(TCW));
	});

	it('files everything as anna rather than guessing a category', () => {
		for (const name of ['tcw-future.json', 'tcw-past.json']) {
			for (const entry of entries(name)) {
				const mapped = mapEntry(entry, TCW);
				if (isFailure(mapped)) continue;
				expect(mapped.category, entry.event.name).toBe('anna');
				expect(CATEGORY_SLUGS).toContain(mapped.category);
			}
		}
	});

	it('prefers the event timezone over the calendar one', () => {
		const entry = only('tcw-future.json', 'evt-sFA6CXwIQiEje10');
		const helsinki = mapEntry(
			{ ...entry, event: { ...entry.event, timezone: 'Europe/Helsinki' } },
			TCW
		);
		if (isFailure(helsinki)) throw new Error(helsinki.problem);
		// A 20:00 Helsinki concert renders as 19:00 if you assume Oslo (CLAUDE.md).
		expect(helsinki.venueTimezone).toBe('Europe/Helsinki');

		const bare = mapEntry({ ...entry, event: { ...entry.event, timezone: null } }, TCW);
		if (isFailure(bare)) throw new Error(bare.problem);
		expect(bare.venueTimezone).toBe('Europe/Oslo');
	});

	it('drops an end time that precedes its start, and keeps the event', () => {
		const entry = only('tcw-future.json', 'evt-sFA6CXwIQiEje10');
		const mapped = mapEntry(
			{ ...entry, event: { ...entry.event, end_at: '2026-10-22T10:00:00.000Z' } },
			TCW
		);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.endsAt).toBeNull();
		expect(mapped.startsAt.toISOString()).toBe('2026-10-22T16:30:00.000Z');
	});

	it('refuses an event with no page to link to', () => {
		const entry = only('tcw-future.json', 'evt-sFA6CXwIQiEje10');
		const mapped = mapEntry({ ...entry, event: { ...entry.event, url: null } }, TCW);
		expect(isFailure(mapped)).toBe(true);
		if (isFailure(mapped)) expect(mapped.problem).toMatch(/no event path/);
	});

	it('never invents a description', () => {
		// get-items carries none, and fetching one page per event to get one would be a crawl.
		for (const entry of entries('tcw-past.json')) {
			const mapped = mapEntry(entry, TCW);
			if (!isFailure(mapped)) expect(mapped.description).toBeNull();
		}
	});

	it('does not name the source page twice', () => {
		// On Luma "read more" and "sign up" are one URL; two identical buttons is not a feature.
		const mapped = mapEntry(only('tcw-future.json', 'evt-sFA6CXwIQiEje10'), TCW);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.ctaUrl).toBeNull();
	});

	it('hotlinks the cover without claiming rights to it', () => {
		const mapped = mapEntry(only('tcw-future.json', 'evt-sFA6CXwIQiEje10'), TCW);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		// Stock art the organiser picked inside Luma — see posterRightsCleared in calendars.ts.
		expect(mapped.posterUrl).toContain('images.unsplash.com');
		expect(mapped.posterRightsVerified).toBe(false);
	});

	it('refuses a cover that is not an http URL', () => {
		const entry = only('tcw-future.json', 'evt-sFA6CXwIQiEje10');
		for (const cover of ['javascript:alert(1)', 'not a url', '']) {
			const mapped = mapEntry({ ...entry, event: { ...entry.event, cover_url: cover } }, TCW);
			if (isFailure(mapped)) throw new Error(mapped.problem);
			expect(mapped.posterUrl, cover).toBeNull();
		}
	});
});

describe('isPublishable', () => {
	const entry = () => only('tcw-future.json', 'evt-sFA6CXwIQiEje10');

	it('takes the approved public event in the fixture', () => {
		expect(isPublishable(entry())).toBe(true);
	});

	it('leaves a private event alone', () => {
		const e = entry();
		expect(isPublishable({ ...e, event: { ...e.event, visibility: 'private' } })).toBe(false);
	});

	it('leaves an event the calendar admin has not approved', () => {
		// Luma lets anybody submit to a public calendar. Republishing a pending submission would
		// put an event on our listing that is not yet on the organiser's own.
		const e = entry();
		expect(isPublishable({ ...e, status: 'pending' })).toBe(false);
	});

	it('drops an online-only event and keeps a hybrid one', () => {
		const e = entry();
		expect(isPublishable({ ...e, event: { ...e.event, location_type: 'online' } })).toBe(false);
		expect(isPublishable({ ...e, event: { ...e.event, location_type: 'hybrid' } })).toBe(true);
	});
});

describe('the calendar registry', () => {
	it('prefixes every slug so /kjelder groups it under Luma', () => {
		// `platformOf` in packages/core/src/directory.ts matches on `luma-`.
		for (const calendar of CALENDARS) {
			expect(calendar.slug.startsWith('luma-'), calendar.slug).toBe(true);
			expect(calendar.slug).not.toBe('luma');
		}
	});

	it('holds a calendar api id, because the handle is not enough', () => {
		for (const calendar of CALENDARS) {
			expect(calendar.calendarApiId, calendar.slug).toMatch(/^cal-/);
		}
	});

	it('gives every calendar a zone rather than an offset', () => {
		for (const calendar of CALENDARS) {
			expect(calendar.timezone, calendar.slug).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$/);
		}
	});

	it('finds a calendar by slug and nothing by a made-up one', () => {
		expect(calendarBySlug('luma-tcw')?.name).toBe('Tech Cluster West');
		expect(calendarBySlug('luma-nope')).toBeUndefined();
	});

	it('builds the endpoint the fixtures were captured from', () => {
		const url = new URL(itemsUrl(TCW, 'future'));
		expect(url.origin + url.pathname).toBe('https://api.lu.ma/calendar/get-items');
		expect(url.searchParams.get('calendar_api_id')).toBe('cal-yKlrTBwsAAkMhX3');
		expect(url.searchParams.get('period')).toBe('future');
		expect(url.searchParams.get('pagination_cursor')).toBeNull();
		expect(new URL(itemsUrl(TCW, 'past', 'abc')).searchParams.get('pagination_cursor')).toBe('abc');
	});

	it('builds reader-facing URLs on luma.com', () => {
		expect(listingUrl(TCW)).toBe('https://luma.com/tcw');
		expect(eventUrl('ahupvg92')).toBe('https://luma.com/ahupvg92');
	});
});

describe('slugifyVenue', () => {
	it('folds Norwegian letters rather than dropping them', () => {
		expect(slugifyVenue('Sæ 134 Stord')).toBe('sae-134-stord');
		expect(slugifyVenue('Bømlo Ø')).toBe('boemlo-oe');
		expect(slugifyVenue('Ådland')).toBe('aadland');
	});

	it('produces one stable slug per venue', () => {
		expect(slugifyVenue('  Sæ 134   Stord  ')).toBe(slugifyVenue('Sæ 134 Stord'));
	});
});
