import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import {
	fetchAllPages,
	MAX_PAGES,
	parseDetails,
	parseListing,
	subTypeList,
	type ReadListing
} from '../src/api.ts';
import { ASSOCIATIONS, associationBySlug, calendarUrl } from '../src/associations.ts';
import {
	htmlToText,
	isFailure,
	mapActivity,
	mapCategory,
	PLACEHOLDER_IMAGE,
	posterFor,
	slugifyVenue
} from '../src/map.ts';

/**
 * Against committed real responses. No network, no clock (CLAUDE.md rule 6).
 */
const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

const stordFitjar = associationBySlug('dnt-stord-fitjar')!;
const bomlo = associationBySlug('dnt-bomlo')!;

const PAGES: Record<string, string[]> = {
	'dnt-stord-fitjar': ['activities-stord-fitjar-page1.json', 'activities-stord-fitjar-page2.json'],
	'dnt-bomlo': [
		'activities-bomlo-page1.json',
		'activities-bomlo-page2.json',
		'activities-bomlo-page3.json'
	]
};

/** Serves the committed pages in place of the network. */
const readFixturePages: ReadListing = async (association, page) => {
	const names = PAGES[association.slug]!;
	const name = names[page - 1];
	if (!name) throw new Error(`no fixture for ${association.slug} page ${page}`);
	return fixture(name);
};

const details617020 = parseDetails(fixture('activitydetails-617020.json'));
const details617197 = parseDetails(fixture('activitydetails-617197.json'));

describe('parseListing', () => {
	it('reads the hits and the pagination off page one', () => {
		const parsed = parseListing(fixture('activities-stord-fitjar-page1.json'));
		expect(parsed.activities).toHaveLength(10);
		expect(parsed.pageCount).toBe(2);
		expect(parsed.totalMatching).toBe(16);
		expect(parsed.rejected).toEqual([]);
	});

	it('throws when the response is not a listing at all', () => {
		// A redesign that moves the endpoint must fail loudly, not import zero events and call it
		// a success — that is the failure mode /datasamling exists to make visible.
		expect(() => parseListing({ nope: true })).toThrow(/unexpected/);
	});

	it('rejects a malformed hit without losing the rest of the page', () => {
		const parsed = parseListing({
			pageHits: [
				{ id: 1, pageTitle: 'ok', activityViewModel: { start: '2026-09-09T10:00:00+02:00' } },
				{ id: 'not a number' }
			],
			pageCount: 1,
			totalMatching: 2
		});
		expect(parsed.activities).toHaveLength(1);
		expect(parsed.rejected).toHaveLength(1);
	});
});

describe('fetchAllPages', () => {
	it('follows pageCount to the end for each turlag', async () => {
		const a = await fetchAllPages(stordFitjar, readFixturePages);
		expect(a.activities).toHaveLength(16);
		expect(a.totalMatching).toBe(16);

		const b = await fetchAllPages(bomlo, readFixturePages);
		expect(b.activities).toHaveLength(27);
		expect(b.totalMatching).toBe(27);
	});

	it('stops at MAX_PAGES when the endpoint claims an implausible page count', async () => {
		let calls = 0;
		const runaway: ReadListing = async () => {
			calls += 1;
			return { pageHits: [], pageCount: 9999, totalMatching: 999999 };
		};
		await fetchAllPages(stordFitjar, runaway);
		expect(calls).toBe(MAX_PAGES);
	});
});

describe('subTypeList', () => {
	it('drops the empty leading field DNT emits', () => {
		// The real value is ", Fottur" — DNT's own UI strips the separator before displaying it.
		expect(subTypeList(', Fottur')).toEqual(['Fottur']);
		expect(subTypeList('')).toEqual([]);
		expect(subTypeList(null)).toEqual([]);
	});
});

describe('mapCategory', () => {
	it('only ever returns a slug in our taxonomy', () => {
		for (const main of ['Fellestur', 'Arrangement', 'Kurs', 'Dugnad', 'Other', 'Noe nytt', '']) {
			expect(CATEGORY_SLUGS).toContain(mapCategory(main, ''));
		}
	});

	it('maps a guided walk to sport, as the Fjord Norway importer already does', () => {
		expect(mapCategory('Fellestur', '')).toBe('sport');
	});

	it('lets a subtype override a vaguer main type', () => {
		expect(mapCategory('Arrangement', ', Fottur')).toBe('sport');
		expect(mapCategory('Arrangement', 'Medlemsmøte')).toBe('mote');
	});

	it('falls back to anna for a type DNT has not used before', () => {
		expect(mapCategory('Ekspedisjon', '')).toBe('anna');
		expect(mapCategory(null, null)).toBe('anna');
	});
});

describe('htmlToText', () => {
	it('keeps paragraph structure instead of running the text together', () => {
		const text = htmlToText('<p>Frå Fitjar Bedehus</p><p>Turen går på merka sti</p>');
		expect(text).toBe('Frå Fitjar Bedehus\n\nTuren går på merka sti');
	});

	it('decodes the entities DNT actually emits', () => {
		expect(htmlToText('<p>KOM DEG UT&nbsp;-dagen</p>')).toBe('KOM DEG UT -dagen');
		expect(htmlToText('<p>&#229;pen &amp; fin</p>')).toBe('åpen & fin');
	});

	it('turns a line break into a line, not a space', () => {
		expect(htmlToText('<p>søndag<br>kl. 11</p>')).toBe('søndag\nkl. 11');
	});

	it('returns null rather than an empty string for markup with no words', () => {
		expect(htmlToText('<p></p>')).toBeNull();
		expect(htmlToText(null)).toBeNull();
	});

	it('reads the real description on the committed detail response', () => {
		const text = htmlToText(details617020?.description);
		expect(text).toContain('Barnas Turlag');
		expect(text).not.toContain('<');
		expect(text).not.toContain('&nbsp;');
	});
});

describe('posterFor', () => {
	it('drops DNT’s brand placeholder', () => {
		// Importing it would fill the listing with identical decorative tiles that carry no
		// information — our generated tile is both more useful and more honest.
		expect(posterFor(PLACEHOLDER_IMAGE)).toBeNull();
	});

	it('keeps a real uploaded photo', () => {
		expect(
			posterFor('https://deltagerfiles.blob.core.windows.net/apistorage/event_title_image_1')
		).toBe('https://deltagerfiles.blob.core.windows.net/apistorage/event_title_image_1');
	});

	it('drops anything that is not an http(s) URL', () => {
		expect(posterFor('javascript:alert(1)')).toBeNull();
		expect(posterFor('')).toBeNull();
	});
});

describe('mapActivity', () => {
	const listing = parseListing(fixture('activities-stord-fitjar-page1.json'));
	const cancelled = listing.activities.find((a) => a.id === 617197)!;

	it('maps the cancelled trip and says so', () => {
		const mapped = mapActivity(cancelled, details617197, stordFitjar);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.cancelled).toBe(true);
		expect(mapped.title).toBe('Fitjartur Dyvikesåto rundt');
		expect(mapped.externalId).toBe('617197');
	});

	it('preserves the source offset rather than normalising to UTC', () => {
		const mapped = mapActivity(cancelled, details617197, stordFitjar);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		// 2026-09-09T10:00 +02:00 is 08:00Z. Storing the instant is right; the point is that the
		// instant matches the source's own offset and was not read as naive local time.
		expect(mapped.startsAt.toISOString()).toBe('2026-09-09T08:00:00.543Z');
	});

	it('links to the turlag calendar, because the per-activity page 500s upstream', () => {
		const mapped = mapActivity(cancelled, details617197, stordFitjar);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.sourceUrl).toBe(calendarUrl(stordFitjar));
		expect(mapped.sourceUrl).toContain('associations=25194');
		expect(mapped.ctaUrl).toContain('aktiviteter.dnt.no');
	});

	it('never claims rights to a photo DNT says nothing about', () => {
		for (const activity of listing.activities) {
			const mapped = mapActivity(activity, null, stordFitjar);
			if (isFailure(mapped)) continue;
			expect(mapped.posterRightsVerified).toBe(false);
		}
	});

	it('maps every activity in both turlag without a rejection', () => {
		for (const [association, names] of Object.entries(PAGES)) {
			const cfg = associationBySlug(association)!;
			for (const name of names) {
				for (const activity of parseListing(fixture(name)).activities) {
					const mapped = mapActivity(activity, null, cfg);
					expect(isFailure(mapped) ? mapped.problem : null).toBeNull();
				}
			}
		}
	});

	it('drops an end that is not after the start', () => {
		// DNT writes end == start when the organiser left the duration blank.
		const mapped = mapActivity(
			{
				id: 1,
				pageTitle: 'x',
				activityViewModel: { start: '2026-09-16T00:00:00+02:00', end: '2026-09-16T00:00:00+02:00' }
			},
			null,
			stordFitjar
		);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.endsAt).toBeNull();
	});

	it('rejects an activity with no view model instead of inventing a time', () => {
		const mapped = mapActivity(
			{ id: 2, pageTitle: 'x', activityViewModel: null },
			null,
			stordFitjar
		);
		expect(isFailure(mapped)).toBe(true);
	});

	it('rejects an unparseable start', () => {
		const mapped = mapActivity(
			{ id: 3, pageTitle: 'x', activityViewModel: { start: 'sometime next spring' } },
			null,
			stordFitjar
		);
		expect(isFailure(mapped)).toBe(true);
	});
});

describe('associations', () => {
	it('gives every turlag a distinct slug and association id', () => {
		expect(new Set(ASSOCIATIONS.map((a) => a.slug)).size).toBe(ASSOCIATIONS.length);
		expect(new Set(ASSOCIATIONS.map((a) => a.associationId)).size).toBe(ASSOCIATIONS.length);
	});

	it('builds a calendar URL a reader can actually open', () => {
		expect(calendarUrl(bomlo)).toBe(
			'https://www.dnt.no/aktivitetskalender/?associations=25197&culture=nb-NO'
		);
	});
});

describe('slugifyVenue', () => {
	it('folds Norwegian letters before stripping accents', () => {
		expect(slugifyVenue('Vabakkjen / Stord')).toBe('vabakkjen-stord');
		expect(slugifyVenue('Bømlo Ø')).toBe('boemlo-oe');
	});
});
