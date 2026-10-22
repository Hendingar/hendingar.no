import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { fetchAll, parseSearch, type ReadSearch } from '../src/api.ts';
import {
	NORWAY_ORGANIZATION_ID,
	ORGANISERS,
	filterFor,
	organiserBySlug,
	organiserUrl,
	searchUrl
} from '../src/organisers.ts';
import {
	MAX_DESCRIPTION,
	isFailure,
	mapCategory,
	mapEvent,
	municipalityOf,
	trimDescription
} from '../src/map.ts';
import { slugifyVenue } from '@hendingar/core/slug';

/**
 * Against a committed real response. No network, no clock (CLAUDE.md rule 6).
 */
const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

const bremnes = organiserBySlug('billetto-bremnes-idrettslag')!;
const search = parseSearch(fixture('bremnes-idrettslag.json'));

describe('the filter', () => {
	it('narrows to the organiser, not just to Norway', () => {
		/*
		 * The mistake this guards. `organization_id:37` is Billetto's Norwegian storefront, shared
		 * by every organiser on the site — filtering on it alone imports the whole country. The
		 * organiser is `organizer_id`, and it appears nowhere in the handle.
		 */
		const filter = filterFor(bremnes);
		expect(filter).toContain(`organization_id:${NORWAY_ORGANIZATION_ID}`);
		expect(filter).toContain(`organizer_id:${bremnes.organizerId}`);
		expect(filter).toContain('NOT kind:subscription');
	});

	it('builds the search URL Billetto’s own page calls', () => {
		expect(searchUrl()).toMatch(
			/^https:\/\/yneuy03z8q-dsn\.algolia\.net\/1\/indexes\/events_by_date\/query\?/
		);
	});
});

describe('parseSearch', () => {
	it('reads the committed response', () => {
		expect(search.events.length).toBeGreaterThan(0);
		expect(search.rejected).toEqual([]);
	});

	it('throws when the response is not a search result at all', () => {
		// A moved index must fail loudly, not import nothing and report success.
		expect(() => parseSearch({ nope: true })).toThrow(/unexpected/);
	});

	it('rejects a malformed hit without losing the rest', () => {
		const parsed = parseSearch({
			hits: [
				{ id: 1, name: 'ok', url: 'https://billetto.no/e/x-1', start_time: 1798311600 },
				{ id: 'no' }
			],
			nbHits: 2
		});
		expect(parsed.events).toHaveLength(1);
		expect(parsed.rejected).toHaveLength(1);
	});
});

describe('fetchAll', () => {
	it('stops when there is only one page', async () => {
		let calls = 0;
		const read: ReadSearch = async () => {
			calls += 1;
			return fixture('bremnes-idrettslag.json');
		};
		const all = await fetchAll(bremnes, read);
		expect(calls).toBe(1);
		expect(all.events).toHaveLength(search.events.length);
	});

	it('caps a runaway page count', async () => {
		let calls = 0;
		const read: ReadSearch = async () => {
			calls += 1;
			return { hits: [], nbHits: 100_000, nbPages: 9999, page: 0 };
		};
		await fetchAll(bremnes, read);
		expect(calls).toBe(10);
	});
});

describe('mapEvent', () => {
	const event = search.events[0]!;

	it('reads the epoch, never the record’s own time zone', () => {
		/*
		 * Billetto reports `time_zone: "Europe/Paris"` for an event in Bømlo. Paris and Oslo share
		 * an offset, so it changes nothing today — which is exactly what makes trusting it
		 * dangerous. `start_time` is an instant and needs no zone.
		 */
		const mapped = mapEvent(event, bremnes);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.startsAt.getTime()).toBe(event.start_time * 1000);
		// 26 December 2026, 20:00 in Oslo.
		expect(mapped.startsAt.toISOString()).toBe('2026-12-26T19:00:00.000Z');
	});

	it('maps every hit in the fixture without a rejection', () => {
		for (const hit of search.events) {
			const mapped = mapEvent(hit, bremnes);
			expect(isFailure(mapped) ? mapped.problem : null).toBeNull();
		}
	});

	it('links to the ticket page, and never claims to sell', () => {
		const mapped = mapEvent(event, bremnes);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.sourceUrl).toMatch(/^https:\/\/billetto\.no\/e\//);
		expect(mapped.ctaUrl).toBe(mapped.sourceUrl);
	});

	it('refuses a hit the platform has not published', () => {
		const mapped = mapEvent({ ...event, state: 'draft' }, bremnes);
		expect(isFailure(mapped)).toBe(true);
	});

	it('drops an end that is not after the start', () => {
		const mapped = mapEvent({ ...event, end_time: event.start_time }, bremnes);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.endsAt).toBeNull();
	});

	it('never claims rights to an image Billetto says nothing about', () => {
		const mapped = mapEvent(event, bremnes);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.posterRightsVerified).toBe(false);
	});
});

describe('mapCategory', () => {
	it('only ever returns a slug in our taxonomy', () => {
		for (const type of ['concert', 'party', 'seminar', 'screening', 'noe-nytt', '']) {
			expect(CATEGORY_SLUGS).toContain(mapCategory(type, 'music'));
		}
	});

	it('prefers the narrower field, because it is the one that distinguishes', () => {
		// "music/concert" and "music/party" are different evenings.
		expect(mapCategory('concert', 'music')).toBe('musikk');
		expect(mapCategory('party', 'music')).toBe('dans');
	});

	it('files a screening as kino', () => {
		expect(mapCategory('screening', 'film')).toBe('kino');
	});

	it('falls back to the broad category when the type says nothing useful', () => {
		expect(mapCategory('other', 'performing_arts')).toBe('teater');
		expect(mapCategory(null, 'sports')).toBe('sport');
	});

	it('falls back to anna rather than guessing', () => {
		expect(mapCategory('other', 'lifestyle')).toBe('anna');
		expect(mapCategory(null, null)).toBe('anna');
	});
});

describe('trimDescription', () => {
	it('keeps a short description whole', () => {
		expect(trimDescription('Kort og godt.')).toBe('Kort og godt.');
	});

	it('cuts a long one at a sentence, not mid-word', () => {
		// Billetto's descriptions run to several hundred words of marketing prose.
		const long = `${'Ein fin kveld med musikk. '.repeat(60)}`;
		const trimmed = trimDescription(long)!;
		expect(trimmed.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
		expect(trimmed.endsWith('.')).toBe(true);
	});

	it('falls back to an ellipsis when there is no sentence to cut at', () => {
		const trimmed = trimDescription('a'.repeat(MAX_DESCRIPTION + 200))!;
		expect(trimmed.endsWith('…')).toBe(true);
	});

	it('returns null for nothing', () => {
		expect(trimDescription(null)).toBeNull();
		expect(trimDescription('   ')).toBeNull();
	});
});

describe('organisers', () => {
	it('gives every organiser a distinct slug, handle and id', () => {
		expect(new Set(ORGANISERS.map((o) => o.slug)).size).toBe(ORGANISERS.length);
		expect(new Set(ORGANISERS.map((o) => o.handle)).size).toBe(ORGANISERS.length);
		expect(new Set(ORGANISERS.map((o) => o.organizerId)).size).toBe(ORGANISERS.length);
	});

	it('attributes to the organiser, whose page it links', () => {
		expect(organiserUrl(bremnes)).toBe('https://billetto.no/users/bremnes-idrettslag');
	});
});

describe('slugifyVenue', () => {
	it('folds Norwegian letters before stripping accents', () => {
		expect(slugifyVenue('Bømlohallen')).toBe('boemlohallen');
	});
});

describe('municipalityOf', () => {
	it('turns a post town into the municipality it is in', () => {
		// The fixture's own `city`. Bremnes is a place on Bømlo, not a municipality, and was stored
		// as one — which took Bømlohallen out of the Bømlo filter.
		expect(municipalityOf('Bremnes')).toBe('Bømlo');
		expect(municipalityOf('Urangsvåg')).toBe('Bømlo');
		expect(municipalityOf('LEIRVIK')).toBe('Stord');
		expect(municipalityOf('Fitjar')).toBe('Fitjar');
	});

	it('writes nothing it cannot place', () => {
		expect(municipalityOf('Bergen')).toBeNull();
		expect(municipalityOf(null)).toBeNull();
		expect(municipalityOf('')).toBeNull();
	});
});

describe('every organiser with a fixture', () => {
	const fixtures: Record<string, string> = {
		'billetto-bremnes-idrettslag': 'bremnes-idrettslag.json',
		'billetto-siggjo-bolse-basarlaug': 'siggjo-bolse-basarlaug.json'
	};

	for (const [slug, file] of Object.entries(fixtures)) {
		it(`${slug}: the configured id is the one on its own events`, () => {
			/*
			 * The id is read by hand off the page's search request and typed into organisers.ts,
			 * and nothing else checks it: a wrong id filters to nobody, and the run reports success
			 * with zero rows. The fixture is what the real filter returned, so every hit in it must
			 * carry the id we filtered on.
			 */
			const organiser = organiserBySlug(slug)!;
			const parsed = parseSearch(fixture(file));
			expect(parsed.events.length).toBeGreaterThan(0);
			expect(parsed.rejected).toEqual([]);
			for (const hit of parsed.events) {
				expect([hit.organizer_id, ...(hit.host_ids ?? [])]).toContain(organiser.organizerId);
			}
		});
	}
});

describe('Siggjo Bolse & Basarlaug', () => {
	const siggjo = organiserBySlug('billetto-siggjo-bolse-basarlaug')!;
	const parsed = parseSearch(fixture('siggjo-bolse-basarlaug.json'));

	it('files the romjulsdans at Langevåg Bygdatun, on Bømlo, at half past seven', () => {
		const mapped = mapEvent(parsed.events[0]!, siggjo);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		// The card on billetto.no reads "26. Desember 2026, 19:30", and the epoch agrees.
		expect(mapped.startsAt.toISOString()).toBe('2026-12-26T18:30:00.000Z');
		expect(mapped.venueName).toBe('Langevåg Bygdatun');
		// Billetto's `city` is "Bømlo" here — the municipality itself, not a post town.
		expect(mapped.municipality).toBe('Bømlo');
		expect(mapped.category).toBe('musikk');
		expect(mapped.sourceUrl).toBe(
			'https://billetto.no/e/romjulsdans-langevag-bygdatun-billetter-2024471'
		);
	});

	it('links the organiser page the source was added from', () => {
		expect(organiserUrl(siggjo)).toBe('https://billetto.no/users/siggjo-bolse-basarlaug');
	});
});
