import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { orNull, parseEvents, parseFilters, parseLocations } from '../src/api.ts';
import type { UpstreamEvent } from '../src/api.ts';
import { SITES, eventUrl, siteBySlug } from '../src/sites.ts';
import {
	isFailure,
	isPublishableEvent,
	mapCategory,
	mapEvent,
	slugifyVenue,
	toInstant
} from '../src/map.ts';

/**
 * Against committed real responses. No network, no clock (CLAUDE.md rule 6).
 */
const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

/**
 * A synthetic row with every field the API actually always sends.
 *
 * Spelled out rather than cast: the schema requires these because the portal supplies them on all
 * 1056 rows, and a test that quietly casts past that would stop the schema catching the day one
 * disappears.
 */
function row(overrides: Partial<UpstreamEvent> & { event_id: number; event_title: string }) {
	return {
		event_status: 'public',
		event_type: 'arrangement',
		event_summary: null,
		event_description: null,
		event_from: null,
		event_to: null,
		event_location_type: null,
		event_location_id: null,
		event_location_custom_title: null,
		event_location_address1: null,
		event_location_zip: null,
		event_location_city: null,
		event_ticket_link: null,
		event_organizer_name: null,
		event_filter_ids: null,
		event_thumbnail: null,
		...overrides
	};
}

const site = siteBySlug('bomlo-aktivitetforalle')!;
const parsed = parseEvents(fixture('events.json'));
const vocabulary = parseFilters(fixture('filters.json'));
const locations = parseLocations(fixture('locations.json'));
const publishable = parsed.rows.filter((r) => isPublishableEvent(r, site.timezone));

describe('orNull', () => {
	it('treats the literal string "None" as absent', () => {
		/*
		 * The API serialises Python's None as the four-character string "None", and not
		 * consistently — the same field is null on one row and "None" on the next. A plain `??`
		 * keeps the word, which is how a venue ends up called None on a poster.
		 */
		expect(orNull('None')).toBeNull();
		expect(orNull(null)).toBeNull();
		expect(orNull('  ')).toBeNull();
		expect(orNull('Bremnes kyrkje')).toBe('Bremnes kyrkje');
	});
});

describe('parseEvents', () => {
	it('reads the committed collection', () => {
		expect(parsed.rows.length).toBeGreaterThan(100);
		expect(parsed.rejected).toEqual([]);
	});

	it('throws when the response is not the API at all', () => {
		// A redesign that moves the endpoint must fail loudly, not import zero events and report
		// success — that is the failure mode /datasamling exists to make visible.
		expect(() => parseEvents('<html>')).toThrow(/unexpected/);
	});
});

describe('isPublishableEvent', () => {
	it('takes public events and leaves archived, draft and standing activities', () => {
		// 122 public arrangements, less the one with no start time.
		expect(publishable.length).toBe(121);
		// The fixture carries each kind we drop, so this is a real assertion rather than a vacuous
		// one on a set that never contained them.
		const dropped = parsed.rows.filter((r) => !isPublishableEvent(r, site.timezone));
		expect(dropped.some((r) => r.event_status === 'archived')).toBe(true);
		expect(dropped.some((r) => r.event_status === 'draft')).toBe(true);
		expect(dropped.some((r) => r.event_type === 'activity')).toBe(true);
	});

	it('keeps the events the portal’s own audience filter would drop', () => {
		/*
		 * The reason this importer filters on `event_type` and not on the tags in the portal's URL.
		 * Ids 81–85 sit on `arrangement` rows and 38–42 on `activity` rows, so the tags correlate
		 * with the distinction — but 56 of the 122 public events carry no audience tag at all, and
		 * they are the touring theatre and the concerts.
		 */
		const untagged = publishable.filter(
			(r) => !(r.event_filter_ids ?? []).some((f) => Number(f) >= 81 && Number(f) <= 85)
		);
		expect(untagged.length).toBe(56);
		const titles = untagged.map((r) => r.event_title).join(' | ');
		expect(titles).toMatch(/Sigvart Dagsland/);
		expect(titles).toMatch(/Riksteatret/);
	});
});

describe('an event with no start time', () => {
	it('is skipped, not rejected', () => {
		// "Rema Cup 2026" is public and carries an end time and no start — a gap in the portal's
		// record, not a change in its shape. Rejecting it would make `rejected` mean two things.
		const undated = parsed.rows.find((r) => String(r.event_id) === '1272')!;
		expect(orNull(undated.event_status)).toBe('public');
		expect(isPublishableEvent(undated, site.timezone)).toBe(false);
	});
});

describe('toInstant', () => {
	it('reads a naive wall clock in the municipality’s zone, not the server’s', () => {
		/*
		 * There is no offset anywhere in the payload. `new Date("2026-09-18 19:00:00")` is the
		 * SERVER's local time — right on a laptop in Norway, an hour or two wrong in CI.
		 */
		expect(toInstant('2026-09-18 19:00:00', 'Europe/Oslo')!.toISOString()).toBe(
			'2026-09-18T17:00:00.000Z'
		);
		// And across the DST boundary, where a fixed offset would drift.
		expect(toInstant('2026-12-05 19:00:00', 'Europe/Oslo')!.toISOString()).toBe(
			'2026-12-05T18:00:00.000Z'
		);
	});

	it('returns null rather than an Invalid Date', () => {
		expect(toInstant(null, 'Europe/Oslo')).toBeNull();
		expect(toInstant('None', 'Europe/Oslo')).toBeNull();
		expect(toInstant('til hausten', 'Europe/Oslo')).toBeNull();
	});
});

describe('mapEvent', () => {
	it('maps every publishable event without a rejection', () => {
		for (const raw of publishable) {
			const mapped = mapEvent(raw, site, vocabulary, locations);
			expect(isFailure(mapped) ? mapped.problem : null).toBeNull();
		}
	});

	it('resolves a venue whether it is named inline or by reference', () => {
		/*
		 * The row says which: `custom` puts the name inline, `location` points at
		 * /api/v1/locations. Reading only the inline field leaves 44 of the 122 with no place.
		 */
		const byReference = publishable.filter(
			(r) => orNull(r.event_location_custom_title) === null && r.event_location_id != null
		);
		expect(byReference.length).toBe(43);
		for (const raw of byReference) {
			const mapped = mapEvent(raw, site, vocabulary, locations);
			if (isFailure(mapped)) throw new Error(mapped.problem);
			expect(mapped.venueName, `no venue for ${mapped.title}`).toBeTruthy();
			expect(mapped.venueName).not.toBe('None');
		}
	});

	it('never leaves the word None anywhere a reader can see it', () => {
		for (const raw of publishable) {
			const mapped = mapEvent(raw, site, vocabulary, locations);
			if (isFailure(mapped)) continue;
			expect(mapped.venueName ?? '').not.toBe('None');
			expect(mapped.description ?? '').not.toBe('None');
			expect(mapped.ctaUrl ?? '').not.toBe('None');
			expect(mapped.posterUrl ?? '').not.toBe('None');
		}
	});

	it('links to the event’s own page, which only public rows have', () => {
		const mapped = mapEvent(publishable[0]!, site, vocabulary, locations);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.sourceUrl).toBe(eventUrl(site, mapped.externalId));
		expect(mapped.sourceUrl).toMatch(/^https:\/\/bomlo\.aktivitetforalle\.no\/arrangement\/\d+$/);
	});

	it('takes the poster the API already built, and claims no rights to it', () => {
		const withPoster = publishable
			.map((r) => mapEvent(r, site, vocabulary, locations))
			.filter((m) => !isFailure(m) && m.posterUrl);
		expect(withPoster.length).toBeGreaterThan(100);
		for (const mapped of withPoster) {
			if (isFailure(mapped)) continue;
			expect(mapped.posterUrl).toMatch(/^https:\/\/.+\/uploads\/.+/);
			expect(mapped.posterRightsVerified).toBe(false);
		}
	});

	it('rejects an unusable start rather than inventing one', () => {
		const mapped = mapEvent(
			row({ event_id: 1, event_title: 'x', event_from: 'None' }),
			site,
			vocabulary,
			locations
		);
		expect(isFailure(mapped)).toBe(true);
	});

	it('drops an end that is not after the start', () => {
		const mapped = mapEvent(
			row({
				event_id: 2,
				event_title: 'x',
				event_from: '2026-09-18 19:00:00',
				event_to: '2026-09-18 19:00:00'
			}),
			site,
			vocabulary,
			locations
		);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.endsAt).toBeNull();
	});
});

describe('mapCategory', () => {
	it('only ever returns a slug in our taxonomy', () => {
		for (const raw of publishable) {
			const ids = (raw.event_filter_ids ?? []).map(String);
			expect(CATEGORY_SLUGS).toContain(mapCategory(ids, vocabulary));
		}
	});

	it('reads the category tags and ignores the audience ones', () => {
		// 83 is "Vaksen", a target_audience. On its own it says nothing about what the event is.
		expect(mapCategory(['83'], vocabulary)).toBe('anna');
	});

	it('maps a named category the platform actually uses', () => {
		const musikk = [...vocabulary].find(
			([, f]) => f.type === 'category' && f.name.toLowerCase() === 'musikk'
		)!;
		expect(mapCategory([musikk[0]], vocabulary)).toBe('musikk');
	});
});

describe('sites', () => {
	it('gives every site a distinct slug and origin', () => {
		expect(new Set(SITES.map((s) => s.slug)).size).toBe(SITES.length);
		expect(new Set(SITES.map((s) => s.origin)).size).toBe(SITES.length);
	});
});

describe('slugifyVenue', () => {
	it('folds Norwegian letters before stripping accents', () => {
		expect(slugifyVenue('Bømlo kulturhus, Svortland')).toBe('boemlo-kulturhus-svortland');
	});
});
