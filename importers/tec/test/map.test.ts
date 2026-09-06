import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { fetchAll, MAX_PAGES, pageUrl, parseCollection, type UpstreamEvent } from '../src/api.ts';
import { INSTANCES, instanceBySlug, type TecInstance } from '../src/instances.ts';
import {
	decodeEntities,
	isAllDay,
	isFailure,
	mapCategory,
	mapEvent,
	posterSrcsetFrom,
	resolveZone,
	slugifyVenue,
	wallClockToInstant,
	type MappedEvent
} from '../src/map.ts';

/**
 * Against committed real responses. No network, no clock (CLAUDE.md rule 6).
 *
 * Four fixtures, each earning its place:
 *
 *   - `bomloteater-upcoming.json` is what the importer actually calls, captured on a day the
 *     calendar had nothing coming up: `total: 0`, `total_pages: 0`, `events: []`. That is the
 *     normal state of this source today and it must parse as an empty success, not as a failure.
 *   - `bomloteater-archive.json` is the same endpoint with `?start_date=2020-01-01`, which is how
 *     the four events the theatre ever published were captured. It carries the misconfigured
 *     `UTC+0` timezone, and its dates fall on both sides of a European DST transition.
 *   - `bikeleague-page-{1,2}.json` come from a **different** site running the same plugin, and are
 *     the control case. bikeleague.org is configured correctly — a real `America/New_York`, with
 *     `utc_start_date` genuinely offset — and it exercises everything Bømlo Teater's four events
 *     cannot: categories, whole-day events, HTML entities in titles, a missing venue, a missing
 *     image, and more than one page. It is a fixture, not an instance: we do not import it.
 */
const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

const upcoming = parseCollection(fixture('bomloteater-upcoming.json'));
const archive = parseCollection(fixture('bomloteater-archive.json'));
const bikeleaguePage1 = fixture('bikeleague-page-1.json');
const bikeleaguePage2 = fixture('bikeleague-page-2.json');
const bikeleague = parseCollection(bikeleaguePage1);
const bikeleagueNext = parseCollection(bikeleaguePage2);

const bomloteater = instanceBySlug('tec-bomloteater')!;

/**
 * The correctly configured control site, as an instance so the mapper can be pointed at it.
 *
 * Its `timezone` is deliberately Europe/Oslo — a value that is *wrong* for a site in Washington —
 * so a test that gets New York wall clocks right can only have got them from the record's own
 * `timezone` field, never from this config.
 */
const bikeleagueInstance: TecInstance = {
	slug: 'tec-bikeleague',
	name: 'League of American Bicyclists',
	url: 'https://bikeleague.org/calendar/',
	endpoint: 'https://bikeleague.org/wp-json/tribe/events/v1/events',
	region: 'Test',
	attribution: 'League of American Bicyclists',
	timezone: 'Europe/Oslo',
	venueFallback: 'På nett',
	defaultCategory: 'anna',
	scheduleCron: '0 5 * * *',
	iconUrl: null,
	posterRightsCleared: false,
	trusted: false
};

const mapped = (input: UpstreamEvent, instance: TecInstance): MappedEvent => {
	const result = mapEvent(input, instance);
	if (isFailure(result)) throw new Error(`expected a mapping, got: ${result.problem}`);
	return result;
};

const byTitle = (collection: { events: UpstreamEvent[] }, fragment: string): UpstreamEvent => {
	const found = collection.events.find((e) => e.title.includes(fragment));
	if (!found) throw new Error(`no event whose title contains ${fragment}`);
	return found;
};

describe('instances', () => {
	it('registers Bømlo Teater', () => {
		expect(bomloteater.name).toBe('Bømlo Teater');
		expect(bomloteater.timezone).toBe('Europe/Oslo');
	});

	/*
	 * /kjelder groups a platform's sources by slug prefix (SOURCE_PLATFORMS in
	 * packages/core/src/directory.ts). A slug without it still imports fine and silently stops
	 * being grouped, which is the kind of break nobody notices.
	 */
	it('gives every site the tec- slug prefix the platform grouping keys off', () => {
		for (const instance of INSTANCES) {
			expect(instance.slug.startsWith('tec-')).toBe(true);
		}
	});

	it('only uses categories that exist in the taxonomy', () => {
		for (const instance of INSTANCES) {
			expect(CATEGORY_SLUGS).toContain(instance.defaultCategory);
		}
	});
});

describe('parseCollection', () => {
	it('reads an empty upcoming calendar as an empty success, not a failure', () => {
		expect(upcoming.events).toEqual([]);
		expect(upcoming.total).toBe(0);
		expect(upcoming.pages).toBe(0);
		expect(upcoming.rejected).toEqual([]);
	});

	it('reads the four events Bømlo Teater has ever published', () => {
		expect(archive.events).toHaveLength(4);
		expect(archive.total).toBe(4);
		expect(archive.pages).toBe(1);
		expect(archive.rejected).toEqual([]);
	});

	it('accepts the control site, including its missing venues and images', () => {
		expect(bikeleague.events).toHaveLength(5);
		expect(bikeleague.rejected).toEqual([]);
		// `venue: []` and `image: false` are how this API spells "none". Validating either as an
		// object would reject the record outright.
		expect(bikeleague.events.some((e) => Array.isArray(e.venue))).toBe(true);
		expect(bikeleague.events.some((e) => e.image === false)).toBe(true);
	});

	it('rejects a record that lost a required field, and keeps the rest', () => {
		const damaged = { events: [{ id: 1 }, ...archive.events], total: 5, total_pages: 1 };
		const result = parseCollection(damaged);
		expect(result.events).toHaveLength(4);
		expect(result.rejected).toHaveLength(1);
		expect(result.rejected[0]).toContain('title');
	});

	it('throws when the envelope itself is not the collection', () => {
		expect(() => parseCollection({ code: 'event-archive-page-not-found' })).toThrow(
			/unexpected tribe/
		);
	});
});

describe('pagination', () => {
	it('asks for the plugin ceiling of 50 per page', () => {
		const url = new URL(pageUrl(bomloteater, 3));
		expect(url.searchParams.get('per_page')).toBe('50');
		expect(url.searchParams.get('page')).toBe('3');
		// No start_date: the plugin's own default window is "from the start of today", which is the
		// source's definition of what is on and needs no clock of ours.
		expect(url.searchParams.get('start_date')).toBeNull();
	});

	it('reads one page when the source says there is one', async () => {
		const asked: number[] = [];
		const result = await fetchAll(bomloteater, async (_instance, page) => {
			asked.push(page);
			return fixture('bomloteater-archive.json');
		});
		expect(asked).toEqual([1]);
		expect(result.events).toHaveLength(4);
	});

	it('reads one page and stops when the calendar is empty', async () => {
		const asked: number[] = [];
		const result = await fetchAll(bomloteater, async (_instance, page) => {
			asked.push(page);
			return fixture('bomloteater-upcoming.json');
		});
		expect(asked).toEqual([1]);
		expect(result.events).toEqual([]);
	});

	it('walks pages and stops at the guard rather than at the source’s page count', async () => {
		// The captured query really does report 36 pages. Without MAX_PAGES this would be 36
		// requests to somebody else's server for a calendar we would never read that far into.
		expect(bikeleague.pages).toBe(36);
		const asked: number[] = [];
		const result = await fetchAll(bikeleagueInstance, async (_instance, page) => {
			asked.push(page);
			return page === 1 ? bikeleaguePage1 : bikeleaguePage2;
		});
		expect(asked).toHaveLength(MAX_PAGES);
		expect(asked[0]).toBe(1);
		expect(asked.at(-1)).toBe(MAX_PAGES);
		expect(result.events).toHaveLength(MAX_PAGES * 5);
	});
});

describe('resolveZone', () => {
	it('does not believe a WordPress manual offset', () => {
		// bomloteater.no reports exactly this, with utc_start_date copied from start_date.
		expect(resolveZone('UTC+0', 'Europe/Oslo')).toBe('Europe/Oslo');
	});

	it('does not believe a non-zero manual offset either, because it has no DST rule', () => {
		expect(resolveZone('UTC+1', 'Europe/Oslo')).toBe('Europe/Oslo');
		expect(resolveZone('UTC-5', 'Europe/Oslo')).toBe('Europe/Oslo');
		expect(resolveZone('UTC', 'Europe/Oslo')).toBe('Europe/Oslo');
		expect(resolveZone('GMT', 'Europe/Oslo')).toBe('Europe/Oslo');
	});

	it('believes a real IANA zone name', () => {
		expect(resolveZone('America/New_York', 'Europe/Oslo')).toBe('America/New_York');
		expect(resolveZone('Europe/Helsinki', 'Europe/Oslo')).toBe('Europe/Helsinki');
	});

	it('falls back on a zone name ICU does not know, rather than throwing', () => {
		expect(resolveZone('Mars/Olympus_Mons', 'Europe/Oslo')).toBe('Europe/Oslo');
	});

	it('falls back when the field is empty or absent', () => {
		expect(resolveZone(null, 'Europe/Oslo')).toBe('Europe/Oslo');
		expect(resolveZone('  ', 'Europe/Oslo')).toBe('Europe/Oslo');
	});
});

describe('wallClockToInstant', () => {
	it('reads a wall clock in the zone it is given', () => {
		expect(wallClockToInstant('2022-12-08 20:00:00', 'Europe/Oslo')?.toISOString()).toBe(
			'2022-12-08T19:00:00.000Z'
		);
	});

	it('keeps the seconds, because a whole-day end depends on them', () => {
		expect(wallClockToInstant('2023-03-29 23:59:59', 'Europe/Oslo')?.toISOString()).toBe(
			'2023-03-29T21:59:59.000Z'
		);
	});

	it('refuses anything that is not the plugin’s shape', () => {
		expect(wallClockToInstant('2022-12-08T20:00:00+01:00', 'Europe/Oslo')).toBeNull();
		expect(wallClockToInstant('8 December 2022', 'Europe/Oslo')).toBeNull();
		expect(wallClockToInstant('', 'Europe/Oslo')).toBeNull();
	});
});

describe('mapEvent, against the mislabelled site', () => {
	it('reads start_date as an Oslo wall clock, in winter time', () => {
		const event = mapped(byTitle(archive, 'Jul i Svingen'), bomloteater);
		// The record says start_date and utc_start_date are both "2022-12-08 20:00:00". Believing
		// utc_start_date would put this at 20:00Z; 20:00 in Bremnes in December is 19:00Z.
		expect(event.startsAt.toISOString()).toBe('2022-12-08T19:00:00.000Z');
		expect(event.startsAt.toISOString()).not.toBe('2022-12-08T20:00:00.000Z');
	});

	it('reads start_date as an Oslo wall clock on the other side of the DST change', () => {
		// 18 October 2024 is still summer time in Norway (it ends on the 27th), so the same 19:30
		// wall clock is an hour further from UTC than the December events above.
		const event = mapped(byTitle(archive, 'Musefella'), bomloteater);
		expect(event.startsAt.toISOString()).toBe('2024-10-18T17:30:00.000Z');
		const winter = mapped(byTitle(archive, 'Julasong'), bomloteater);
		expect(winter.startsAt.toISOString()).toBe('2022-12-26T19:00:00.000Z');
	});

	it('carries the end instant through the same way', () => {
		const event = mapped(byTitle(archive, 'Jul i Svingen'), bomloteater);
		expect(event.endsAt?.toISOString()).toBe('2022-12-11T20:00:00.000Z');
	});

	it('keys on the post id', () => {
		expect(mapped(byTitle(archive, 'Jul i Svingen'), bomloteater).externalId).toBe('31');
	});

	it('files a theatre’s uncategorised events under the site default', () => {
		// Every one of the four carries an empty `categories`, so this is the instance's answer.
		for (const raw of archive.events) {
			expect(raw.categories).toEqual([]);
			expect(mapped(raw, bomloteater).category).toBe('teater');
		}
	});

	it('names the venue the way consolidation can match it', () => {
		const event = mapped(byTitle(archive, 'Jul i Svingen'), bomloteater);
		expect(event.venueName).toBe('Bømlo Kulturhus');
		expect(event.venueSlug).toBe('boemlo-kulturhus');
	});

	it('hotlinks the poster but claims no rights over it', () => {
		const event = mapped(byTitle(archive, 'Jul i Svingen'), bomloteater);
		expect(event.posterUrl).toMatch(/^https:\/\/bomloteater\.no\/wp-content\/uploads\//);
		expect(event.posterRightsVerified).toBe(false);
	});

	it('leaves ctaUrl null when the source states no outbound link', () => {
		// `website` is an empty string on all four records, which is not a URL.
		const event = mapped(byTitle(archive, 'Jul i Svingen'), bomloteater);
		expect(event.ctaUrl).toBeNull();
		expect(event.sourceUrl).toBe('https://bomloteater.no/arrangement/jul-i-svingen/');
	});

	it('maps all four without a single failure', () => {
		expect(archive.events.map((e) => mapEvent(e, bomloteater)).filter(isFailure)).toEqual([]);
	});
});

describe('mapEvent, against the correctly configured site', () => {
	it('believes the record’s own IANA zone over the instance fallback', () => {
		// The instance says Europe/Oslo, which is wrong for Washington. 14:00 on 3 March 2023 is
		// still EST — a week before the US clocks go forward — so it is 19:00Z.
		const event = mapped(byTitle(bikeleague, 'How to Write a Lett'), bikeleagueInstance);
		expect(event.startsAt.toISOString()).toBe('2023-03-03T19:00:00.000Z');
	});

	it('follows that zone across its own DST transition', () => {
		// 26 March is EDT, so local midnight is 04:00Z rather than the 05:00Z it would be in March
		// before the change. A fixed `UTC-5` would have got one of these two wrong.
		const event = mapped(byTitle(bikeleague, 'National Bike Summit'), bikeleagueInstance);
		expect(event.startsAt.toISOString()).toBe('2023-03-26T04:00:00.000Z');
	});

	it('keeps a whole-day event’s own span instead of inventing an hour', () => {
		const raw = byTitle(bikeleague, 'National Bike Summit');
		expect(raw.all_day).toBe(true);
		expect(isAllDay(raw)).toBe(true);
		const event = mapped(raw, bikeleagueInstance);
		// Local 00:00:00 -> local 23:59:59, exactly as the source wrote it: an unambiguous,
		// recoverable encoding of "all day" that a later card can read back.
		expect(event.startsAt.toISOString()).toBe('2023-03-26T04:00:00.000Z');
		expect(event.endsAt?.toISOString()).toBe('2023-03-30T03:59:59.000Z');
	});

	it('decodes the entities the plugin escapes into its titles', () => {
		const event = mapped(byTitle(bikeleagueNext, 'O&#8217;Ahu'), bikeleagueInstance);
		expect(event.title).toContain('O’Ahu');
		expect(event.title).toContain('June 9 – June 11');
		expect(event.title).not.toContain('&#');
	});

	it('falls back to the configured venue when the record has none', () => {
		const raw = byTitle(bikeleague, 'How to Write a Lett');
		expect(Array.isArray(raw.venue)).toBe(true);
		expect(mapped(raw, bikeleagueInstance).venueName).toBe('På nett');
	});

	it('leaves the poster empty when the record has no image', () => {
		const raw = byTitle(bikeleague, 'How to Write a Lett');
		expect(raw.image).toBe(false);
		const event = mapped(raw, bikeleagueInstance);
		expect(event.posterUrl).toBeNull();
		expect(event.posterSrcset).toBeNull();
	});

	it('reads the outbound link the organiser stated, with its entities decoded', () => {
		// The raw record says `…?v=h-uHTKqLUd4&amp;t=7s`. Left alone that parses as a URL with a
		// parameter called `amp;t` — a broken link that nothing would ever reject.
		const raw = byTitle(bikeleague, 'How to Write a Lett');
		expect(raw.website).toContain('&amp;');
		expect(mapped(raw, bikeleagueInstance).ctaUrl).toBe(
			'https://www.youtube.com/watch?v=h-uHTKqLUd4&t=7s'
		);
	});

	it('translates the site’s own category terms', () => {
		expect(mapped(byTitle(bikeleague, 'How to Write a Lett'), bikeleagueInstance).category).toBe(
			'konferanse'
		);
		// `summit` is not a term we recognise, so it stays on the instance default rather than
		// being guessed at from the title.
		expect(mapped(byTitle(bikeleague, 'National Bike Summit'), bikeleagueInstance).category).toBe(
			'anna'
		);
	});

	it('maps both pages without a single failure', () => {
		const all = [...bikeleague.events, ...bikeleagueNext.events];
		expect(all.map((e) => mapEvent(e, bikeleagueInstance)).filter(isFailure)).toEqual([]);
	});
});

describe('mapCategory', () => {
	const of = (slug: string, name = slug) => mapCategory([{ slug, name }], 'anna');

	it('only ever returns a slug the taxonomy defines', () => {
		for (const slug of ['teater', 'konsert', 'kurs', 'webinar', 'dans', 'sommerfest']) {
			expect(CATEGORY_SLUGS).toContain(of(slug));
		}
	});

	it('does not mistake ekskursjon for a course', () => {
		// `kurs` sits in the middle of it. The same trap importers/bakhagen fell into.
		expect(of('ekskursjon', 'Ekskursjon')).toBe('anna');
		expect(of('dansekurs', 'Dansekurs')).toBe('kurs');
	});

	it('reads a hyphenated term as one word as well as as several', () => {
		expect(of('stand-up', 'Stand-up')).toBe('stand-up');
		expect(of('lci-seminar', 'LCI Seminar')).toBe('konferanse');
	});

	it('names an event by its last morpheme, the way Norwegian does', () => {
		expect(of('teaterkurs', 'Teaterkurs')).toBe('kurs');
		expect(of('musikkfestival', 'Musikkfestival')).toBe('festival');
		expect(of('teater', 'Teater')).toBe('teater');
	});

	it('reads the term name when the slug has been stripped of its Norwegian letters', () => {
		// WordPress slugs `Årsmøte` as `arsmote`, which carries neither stem.
		expect(mapCategory([{ slug: 'arsmote', name: 'Årsmøte' }], 'anna')).toBe('mote');
	});

	it('decodes entities in a term name before matching', () => {
		expect(mapCategory([{ slug: 'mat-drikke', name: 'Teater &#038; dans' }], 'anna')).toBe(
			'teater'
		);
	});

	it('takes the instance default when nothing matches, including no terms at all', () => {
		expect(mapCategory([], 'teater')).toBe('teater');
		expect(mapCategory(null, 'teater')).toBe('teater');
		expect(mapCategory([{ slug: 'summit', name: 'Summit' }], 'teater')).toBe('teater');
	});

	it('is order-independent across an event’s terms', () => {
		const terms = [
			{ slug: 'musikk', name: 'Musikk' },
			{ slug: 'festival', name: 'Festival' }
		];
		expect(mapCategory(terms, 'anna')).toBe('festival');
		expect(mapCategory([...terms].reverse(), 'anna')).toBe('festival');
	});
});

describe('posterSrcsetFrom', () => {
	const image = () => {
		const raw = byTitle(archive, 'Jul i Svingen');
		if (!raw.image || typeof raw.image !== 'object') throw new Error('fixture lost its image');
		return raw.image;
	};

	it('builds the WordPress rendition ladder, widest last', () => {
		const srcset = posterSrcsetFrom(image());
		expect(srcset).toBe(
			[
				'https://bomloteater.no/wp-content/uploads/2022/10/2000_MZ211130__D5A3348-300x200.jpg 300w',
				'https://bomloteater.no/wp-content/uploads/2022/10/2000_MZ211130__D5A3348-768x512.jpg 768w',
				'https://bomloteater.no/wp-content/uploads/2022/10/2000_MZ211130__D5A3348-1024x683.jpg 1024w',
				'https://bomloteater.no/wp-content/uploads/2022/10/2000_MZ211130__D5A3348.jpg 1511w'
			].join(', ')
		);
	});

	it('leaves the square crop out, because it is a different picture', () => {
		// WordPress's `thumbnail` is 150x150 of a 1511x1008 photo. In a srcset that tells the
		// browser it may swap one for the other.
		const srcset = posterSrcsetFrom(image());
		expect(srcset).not.toContain('150w');
		expect(srcset).not.toContain('150x150');
	});

	it('offers no srcset when there is nothing to choose between', () => {
		expect(posterSrcsetFrom(null)).toBeNull();
		expect(
			posterSrcsetFrom({ url: 'https://example.no/a.jpg', width: 800, height: 600, sizes: null })
		).toBeNull();
	});
});

describe('text and slugs', () => {
	it('decodes numeric and named entities alike', () => {
		expect(decodeEntities('B&#248;mlo &amp; Stord &#8211; &#x2019;25')).toBe('Bømlo & Stord – ’25');
	});

	it('leaves something that is not an entity alone', () => {
		expect(decodeEntities('5 & 10 < 20')).toBe('5 & 10 < 20');
	});

	it('slugs Norwegian letters the way the rest of the importers do', () => {
		expect(slugifyVenue('Bømlo Kulturhus')).toBe('boemlo-kulturhus');
		expect(slugifyVenue('Moster Amfi')).toBe('moster-amfi');
	});
});

describe('mapEvent failures', () => {
	it('reports an unreadable start rather than storing an Invalid Date', () => {
		const raw = { ...byTitle(archive, 'Jul i Svingen'), start_date: 'neste helg' };
		const result = mapEvent(raw, bomloteater);
		expect(isFailure(result)).toBe(true);
		if (isFailure(result)) expect(result.problem).toContain('unreadable start_date');
	});

	it('reports an empty title', () => {
		const raw = { ...byTitle(archive, 'Jul i Svingen'), title: '   ' };
		const result = mapEvent(raw, bomloteater);
		expect(isFailure(result)).toBe(true);
		if (isFailure(result)) expect(result.problem).toBe('empty title');
	});

	it('drops an end that is not after the start', () => {
		const raw = { ...byTitle(archive, 'Jul i Svingen'), end_date: '2022-12-08 20:00:00' };
		expect(mapped(raw, bomloteater).endsAt).toBeNull();
	});
});

describe('the venue address', () => {
	it('is read off the venue block, when the instance filled it in', () => {
		// The archive page is where the venue block is filled in; the upcoming page omits it.
		const withAddress = archive.events
			.map((e) => mapped(e, bomloteater))
			.filter((m) => m.venueAddress.street !== null);

		expect(withAddress.length, 'the fixture should carry at least one address').toBeGreaterThan(0);
		for (const m of withAddress) {
			expect(m.venueAddress.street).toMatch(/\d/);
			if (m.venueAddress.postalCode) expect(m.venueAddress.postalCode).toMatch(/^\d{4}$/);
		}
	});
});
