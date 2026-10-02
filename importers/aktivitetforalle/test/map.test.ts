import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { orNull, parseEvents, parseFilters, parseLocations, parseOrganizers } from '../src/api.ts';
import type { UpstreamEvent, UpstreamUpload } from '../src/api.ts';
import { SITES, eventUrl, siteBySlug } from '../src/sites.ts';
import {
	isFailure,
	isPublishableActivity,
	isPublishableEvent,
	mapCategory,
	mapEvent,
	mapWeeklyHours,
	posterSrcsetFrom,
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
		event_week_interval: null,
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

/**
 * The same endpoint, re-read on 2026-10-01, trimmed to the four rows whose uploads differ in shape:
 * the event this was reported against, an upload from before the platform's redesign, one with no
 * ladder at all, and one with no picture.
 *
 * It is a second fixture rather than a replacement because `events.json` is the only committed
 * record of the response as it was — `archived` rows, absolute upload URLs — and the point of the
 * pair is that both spellings have to map to a poster.
 */
const today = parseEvents(fixture('events-2026-10.json'));
const byId = (id: string) => today.rows.find((r) => String(r.event_id) === id)!;
const mapToday = (id: string) => {
	const mapped = mapEvent(byId(id), site, vocabulary, locations);
	if (isFailure(mapped)) throw new Error(mapped.problem);
	return mapped;
};

describe('the poster', () => {
	it('resolves an upload URL the portal spells relative to its own root', () => {
		/*
		 * What this was reported as: an event with a picture on the portal and a generated tile
		 * here. `upload_url` was absolute when this importer was written and is `/uploads/…` now,
		 * on every upload the portal holds. `new URL()` threw, the mapper read that as "no poster",
		 * and the run still reported success — so 81 of 82 events lost their picture in silence.
		 */
		expect(orNull(byId('19999').event_thumbnail?.upload_url)).toBe(
			'/uploads/bomlo/event/2026/09/1ae4f3ebd5a344799886eb697c67e629/original.jpg'
		);
		expect(mapToday('19999').posterUrl).toBe(
			'https://bomlo.aktivitetforalle.no/uploads/bomlo/event/2026/09/1ae4f3ebd5a344799886eb697c67e629/original.jpg'
		);
	});

	it('still takes an absolute one, which is how the portal used to spell it', () => {
		// The older fixture, unchanged. A base is only ever applied to a relative path, so making
		// the mapper tolerant of one spelling did not make it blind to the other.
		const withPoster = publishable
			.map((r) => mapEvent(r, site, vocabulary, locations))
			.filter((m) => !isFailure(m) && m.posterUrl);
		expect(withPoster.length).toBeGreaterThan(100);
		for (const mapped of withPoster) {
			if (isFailure(mapped)) continue;
			// Case-insensitive: one upload is named `original.PNG`, which is the portal keeping
			// whatever the organiser's phone called the file.
			expect(mapped.posterUrl).toMatch(
				/^https:\/\/bomlo\.aktivitetforalle\.no\/uploads\/.+\.(jpg|jpeg|png)$/i
			);
			expect(mapped.posterRightsVerified).toBe(false);
		}
	});

	it('builds the ladder from one format, beside the original', () => {
		/*
		 * webp where the portal renders webp: a `srcset` candidate is chosen on width alone, so a
		 * ladder that mixes formats tells the browser two files are interchangeable when only one
		 * of them may be decodable.
		 */
		const srcset = mapToday('19999').posterSrcset!;
		const candidates = srcset.split(', ');
		expect(candidates).toHaveLength(7);
		expect(candidates[0]).toBe(
			'https://bomlo.aktivitetforalle.no/uploads/bomlo/event/2026/09/1ae4f3ebd5a344799886eb697c67e629/original-384w.webp 384w'
		);
		expect(srcset).toContain('original-1920w.webp 1920w');
		expect(srcset).not.toMatch(/\.(avif|jpeg)/);
		// Ascending, which is what a browser's candidate list is read as.
		const widths = candidates.map((c) => Number(c.split(' ')[1]!.replace('w', '')));
		expect([...widths].sort((a, b) => a - b)).toEqual(widths);
	});

	it('falls back to avif for the uploads that have nothing else', () => {
		/*
		 * The renditions from before the redesign are avif and nothing else, and the alternative is
		 * hotlinking a 1.4 MB PNG into an 88px square on a phone. avif is last in the order, not
		 * absent from it — and a browser that cannot decode one shows `EventThumb`'s generated tile
		 * rather than a broken image.
		 */
		const mapped = mapToday('66');
		expect(mapped.posterUrl).toMatch(/\/original\.png$/);
		expect(mapped.posterSrcset).toMatch(/w384\.avif 384w/);
		expect(mapped.posterSrcset).toMatch(/w1280\.avif 1280w$/);
	});

	it('leaves the srcset null where the portal renders only one size', () => {
		// A 244×163 upload with no renditions at all. One candidate is not a ladder; the tile falls
		// back to a plain `src`, which is what EventThumb does with a null srcset.
		const mapped = mapToday('65');
		expect(mapped.posterUrl).toMatch(/\/original\.png$/);
		expect(mapped.posterSrcset).toBeNull();
	});

	it('is absent, not invented, for an event with no picture', () => {
		const mapped = mapToday('2974');
		expect(mapped.posterUrl).toBeNull();
		expect(mapped.posterSrcset).toBeNull();
	});

	it('drops an upload the portal says it no longer holds', () => {
		const mapped = mapEvent(
			row({
				event_id: 3,
				event_title: 'x',
				event_from: '2026-09-18 19:00:00',
				event_thumbnail: { upload_url: '/uploads/gone/original.jpg', upload_exists: false }
			}),
			site,
			vocabulary,
			locations
		);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.posterUrl).toBeNull();
	});
});

describe('posterSrcsetFrom', () => {
	type Variant = NonNullable<UpstreamUpload['upload_variants']>[number];
	const ladder = (variants: Variant[], resolution = '1000x500') => ({
		upload_url: '/uploads/x/original.jpg',
		upload_resolution: resolution,
		upload_variants: variants
	});

	it('refuses a rendition that is a crop rather than a resize', () => {
		/*
		 * Measured, not excluded by name: a square thumbnail of a landscape poster is a different
		 * picture, and offering it as a smaller version of the same one is how a face gets cut in
		 * half at one breakpoint and not the next.
		 */
		const srcset = posterSrcsetFrom(
			ladder([
				{ name: 'original-400w.webp', width: 400, height: 200, format: 'webp' },
				{ name: 'original-800w.webp', width: 800, height: 400, format: 'webp' },
				{ name: 'square.webp', width: 300, height: 300, format: 'webp' }
			]),
			'https://bomlo.aktivitetforalle.no/uploads/x/original.jpg'
		);
		expect(srcset).toBe(
			'https://bomlo.aktivitetforalle.no/uploads/x/original-400w.webp 400w, ' +
				'https://bomlo.aktivitetforalle.no/uploads/x/original-800w.webp 800w'
		);
	});

	it('keeps every rendition when the portal states no resolution to judge them by', () => {
		const srcset = posterSrcsetFrom(
			ladder(
				[
					{ name: 'a.webp', width: 400, height: 200, format: 'webp' },
					{ name: 'b.webp', width: 800, height: 400, format: 'webp' }
				],
				'None'
			),
			'https://bomlo.aktivitetforalle.no/uploads/x/original.jpg'
		);
		expect(srcset).toContain('a.webp 400w');
		expect(srcset).toContain('b.webp 800w');
	});

	it('survives a ladder it cannot read', () => {
		// A poster is worth more than a srcset: an unreadable `upload_variants` must cost the
		// ladder and nothing else, which is what the `.catch` on the schema is for.
		const parsed = parseEvents({
			data: [
				{
					event_id: 9,
					event_title: 'x',
					event_status: 'public',
					event_type: 'arrangement',
					event_from: '2026-09-18 19:00:00',
					event_thumbnail: {
						upload_url: '/uploads/x/original.jpg',
						upload_variants: 'nope'
					}
				}
			]
		});
		expect(parsed.rejected).toEqual([]);
		const mapped = mapEvent(parsed.rows[0]!, site, vocabulary, locations);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.posterUrl).toBe('https://bomlo.aktivitetforalle.no/uploads/x/original.jpg');
		expect(mapped.posterSrcset).toBeNull();
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

describe('the venue address', () => {
	/*
	 * `location.address` is required for Google's Event rich result, and no event had one — this
	 * portal has been handing us a street, a postnummer and a town in three fields all along and
	 * the importer dropped all three.
	 */
	it('is read off the location the portal points at', () => {
		const withAddress = publishable
			.map((raw) => mapEvent(raw, site, vocabulary, locations))
			.filter((m) => !isFailure(m) && m.venueAddress.street !== null);

		expect(withAddress.length, 'the fixture should contain at least one address').toBeGreaterThan(
			0
		);
		for (const m of withAddress) {
			if (isFailure(m)) continue;
			expect(m.venueAddress.street).toMatch(/\d/);
			if (m.venueAddress.postalCode) expect(m.venueAddress.postalCode).toMatch(/^\d{4}$/);
		}
	});

	it('is absent rather than invented where the portal gave none', () => {
		for (const raw of publishable) {
			const m = mapEvent(raw, site, vocabulary, locations);
			if (isFailure(m)) continue;
			// Never an empty string: `null` and `""` mean different things to the upsert, and one of
			// them would write a blank address over a real one.
			expect(m.venueAddress.street === null || m.venueAddress.street.length > 0).toBe(true);
		}
	});
});

/**
 * The standing weekly activities — every `activity` row the portal held on 2026-10-02.
 *
 * A separate fixture from `events.json`, which was captured before these were imported and holds
 * only six. Trimmed to the fields the importer reads, with addresses and phone numbers in the
 * free text replaced: several descriptions carry a parent volunteer's private e-mail.
 */
describe('activities', () => {
	const activities = parseEvents(fixture('activities.json'));
	const organizers = parseOrganizers(fixture('organizers.json'));
	const listed = activities.rows.filter((r) => isPublishableActivity(r, site.timezone));
	const mapped = listed.map((r) => mapEvent(r, site, vocabulary, locations, organizers));
	const byId = (id: number) => {
		const m = mapped.find((x) => x.externalId === String(id));
		if (!m || isFailure(m)) throw new Error(`activity ${id} did not map`);
		return m;
	};

	it('takes every public activity that says when it meets', () => {
		expect(activities.rejected).toEqual([]);
		expect(listed.length).toBe(132);
		expect(mapped.filter(isFailure)).toEqual([]);
	});

	it('leaves the ones with no timetable at the source', () => {
		// "Bømlo Soul Children", a motorsport club's "Treninger", and "badebursdag": all public, all
		// repeating, none saying when. There is nothing for a reader to go to.
		const left = activities.rows.filter(
			(r) => orNull(r.event_status) === 'public' && !isPublishableActivity(r, site.timezone)
		);
		expect(left.map((r) => String(r.event_id)).sort()).toEqual(['3168', '34', '70']);
	});

	it('is never taken as a dated event, and never the other way round', () => {
		// The two predicates must not overlap, or a row would be imported under both readings.
		expect(listed.some((r) => isPublishableEvent(r, site.timezone))).toBe(false);
		expect(parsed.rows.filter((r) => isPublishableEvent(r, site.timezone)).length).toBe(121);
		expect(
			parsed.rows.some(
				(r) => isPublishableActivity(r, site.timezone) && r.event_type !== 'activity'
			)
		).toBe(false);
	});

	it('reads Bremnes G12 exactly as the portal shows it', () => {
		// Rendered on bomlo.aktivitetforalle.no/aktivitetar/89: "Kvar veke · Tysdag kl. 18:00 -
		// 19:30 · Onsdag kl. 18:00 - 19:30 · Laurdag kl. 11:30 - 13:00".
		const g12 = byId(89);
		expect(g12.weeklyHours).toEqual({
			cadence: 'weekly',
			slots: [
				{ weekday: 2, from: '18:00', to: '19:30' },
				{ weekday: 3, from: '18:00', to: '19:30' },
				{ weekday: 6, from: '11:30', to: '13:00' }
			]
		});
		expect(g12.organizerName).toBe('Bremnes Idrettslag');
		expect(g12.sourceUrl).toBe('https://bomlo.aktivitetforalle.no/aktivitetar/89');
	});

	it('keeps a fortnightly service fortnightly', () => {
		// The portal: "Partalsveker · Søndag kl. 11:00 - 12:30". Every Sunday would be half wrong.
		expect(byId(25).weeklyHours?.cadence).toBe('even-weeks');
		expect(byId(30).weeklyHours?.cadence).toBe('odd-weeks');
		expect(byId(36).weeklyHours?.cadence).toBe('last-of-month');
	});

	it('reads an unset interval as weekly, which is what the portal prints for it', () => {
		// "Turn 3-4 år" has `event_week_interval: null`; its page says "Kvar veke".
		const turn = activities.rows.find((r) => String(r.event_id) === '923')!;
		expect(turn.event_week_interval).toBeNull();
		expect(byId(923).weeklyHours?.cadence).toBe('weekly');
	});

	it('names the organiser by the name it goes by, not the business register', () => {
		// Organiser 53 is "Bømlo Kommune Skular" in the register and "Bømlo Kulturskule" on the
		// portal. Only the second means anything to a parent looking for piano lessons.
		expect(byId(115).organizerName).toBe('Bømlo Kulturskule');
	});

	it('refuses an interval it has no word for, rather than calling it weekly', () => {
		const odd = row({
			event_id: 1,
			event_title: 'x',
			event_type: 'activity',
			event_week_interval: 'every-third-week',
			event_weekdays: [{ value: 'Monday', from_time: '18:00:00', to_time: '19:00:00' }]
		});
		expect(mapWeeklyHours(odd)).toEqual({
			problem: 'unknown event_week_interval: every-third-week'
		});
	});

	it('skips an activity too short to be a season, so it never lands under a date at midnight', () => {
		// Starts 00:00 like every activity. As a three-week row it would classify `dated` and be
		// filed under its first day as a midnight event.
		const course = row({
			event_id: 2,
			event_title: 'Kort kurs',
			event_type: 'activity',
			event_from: '2026-10-05 00:00:00',
			event_to: '2026-10-26 23:59:59',
			event_weekdays: [{ value: 'Monday', from_time: '18:00:00', to_time: '19:00:00' }]
		});
		expect(isPublishableActivity(course, site.timezone)).toBe(false);
	});
});

describe('parseOrganizers', () => {
	it('leaves out an organiser the portal does not show publicly', () => {
		const names = parseOrganizers({
			data: [
				{ organizer_id: 1, organizer_title: 'Synleg lag', organizer_public: true },
				{ organizer_id: 2, organizer_title: 'Skjult lag', organizer_public: false }
			]
		});
		expect([...names.values()]).toEqual(['Synleg lag']);
	});
});
