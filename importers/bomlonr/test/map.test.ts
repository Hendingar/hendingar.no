import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { parseListing } from '../src/api.ts';
import { isFailure, mapCategory, mapEvent, toInstant, venueFrom } from '../src/map.ts';

/**
 * Against a committed real response. No network, no clock (CLAUDE.md rule 6).
 *
 * The fixture is the listing page as it was served, trimmed to twelve of its hundred events —
 * chosen for shape rather than for recency: ones with a host and ones without, a conference, a
 * course, the one that states its venue, and two in summer, which is where a wrong assumption
 * about the offset would show up.
 */
const html = readFileSync(
	fileURLToPath(new URL('./fixtures/hendingar.html', import.meta.url)),
	'utf8'
);
const parsed = parseListing(html);

describe('parseListing', () => {
	it('reads the data the page carries for its own hydration', () => {
		expect(parsed.rows.length).toBe(12);
		expect(parsed.rejected).toEqual([]);
	});

	it('throws when the blob is gone, rather than importing nothing', () => {
		/*
		 * A redesign must fail loudly. Returning zero events would be reported as a clean run on
		 * /datasamling, which is exactly the silent stop that page exists to make visible.
		 */
		expect(() => parseListing('<html><body>Hendingar</body></html>')).toThrow(/__NEXT_DATA__/);
		expect(() =>
			parseListing('<script id="__NEXT_DATA__" type="application/json">{oops</script>')
		).toThrow(/not JSON/);
		expect(() =>
			parseListing('<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>')
		).toThrow(/unexpected/);
	});
});

describe('toInstant', () => {
	it('believes the stamp, because this source publishes real instants', () => {
		/*
		 * The opposite call from `importers/mec`, and made on evidence rather than by default: the
		 * summer events in this fixture carry `+00:00` and their own descriptions state a wall
		 * clock two hours later, which is CEST. A December one states one hour later, which is CET.
		 * An offset that is right on both sides of the change is a real offset.
		 */
		expect(toInstant('2026-06-16T06:00:00+00:00')!.toISOString()).toBe('2026-06-16T06:00:00.000Z');
		expect(toInstant('2026-12-22T17:30:00+00:00')!.toISOString()).toBe('2026-12-22T17:30:00.000Z');
	});

	it('returns null rather than an Invalid Date', () => {
		expect(toInstant(null)).toBeNull();
		expect(toInstant('til hausten')).toBeNull();
		expect(toInstant('')).toBeNull();
	});
});

describe('mapEvent', () => {
	it('maps every row in the fixture without a rejection', () => {
		for (const raw of parsed.rows) {
			const mapped = mapEvent(raw);
			expect(isFailure(mapped) ? mapped.problem : null).toBeNull();
		}
	});

	it('links to the event’s own page, not to the listing', () => {
		// We are an index: a reader should land on the organiser's page for the event itself.
		const mapped = mapEvent(parsed.rows.find((r) => r.name === 'Heim igjen 2026')!);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.sourceUrl).toBe('https://www.bomlonr.no/hendingar/heim-igjen-2026');
	});

	it('keys on the CMS id, never on the date', () => {
		/*
		 * A re-timed event must update in place. Keying on a start instant inserts a second row and
		 * abandons the first — still published, still wrong — which is the lesson written into
		 * `importers/mec`.
		 */
		const mapped = mapEvent(parsed.rows[0]!);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.externalId).toBe(parsed.rows[0]!.id);
		expect(mapped.externalId).not.toContain('2026');
	});

	it('takes the host as the organiser and never as a place', () => {
		/*
		 * "Siemens Energy" hosts a frukostmøte. Writing that into `venues` would invent a place
		 * called Siemens Energy that nobody can visit, and it would sit on the map beside real
		 * halls.
		 */
		const hosted = parsed.rows.find((r) => r.host?.name?.includes('Siemens'))!;
		const mapped = mapEvent(hosted);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.organizerName).toBe('Siemens Energy');
		expect(mapped.venueName).toBeNull();
	});

	it('drops an end that is not after the start', () => {
		const mapped = mapEvent({
			id: 'x',
			slug: 'x',
			name: 'x',
			starttime: '2026-03-02T08:00:00+00:00',
			endtime: '2026-03-02T08:00:00+00:00',
			host: null,
			about: null
		});
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.endsAt).toBeNull();
	});

	it('rejects a row with no usable start rather than inventing one', () => {
		const mapped = mapEvent({
			id: 'x',
			slug: 'x',
			name: 'x',
			starttime: 'snart',
			endtime: null,
			host: null,
			about: null
		});
		expect(isFailure(mapped)).toBe(true);
	});
});

describe('venueFrom', () => {
	it('reads the line the organiser wrote for a reader', () => {
		// The only place a venue appears at all: there is no location field in the payload.
		expect(venueFrom('Velkomen!\n\nStad: Bømlo Kulturhus  \nPris: Gratis')).toBe('Bømlo Kulturhus');
		expect(venueFrom('**Stad:** Moster Amfi')).toBe('Moster Amfi');
	});

	it('is null where nothing says, which is most of them', () => {
		expect(venueFrom('Vi møtest til frukost.')).toBeNull();
		expect(venueFrom(null)).toBeNull();
	});

	it('refuses a paragraph that merely begins with the word', () => {
		// A place name is short. Anything longer is prose, and prose in `venues.name` is a venue
		// nobody can match against a real hall.
		expect(venueFrom(`Stad: ${'a'.repeat(120)}`)).toBeNull();
	});
});

describe('mapCategory', () => {
	it('only ever returns a slug in our taxonomy', () => {
		for (const raw of parsed.rows) {
			expect(CATEGORY_SLUGS).toContain(mapCategory(raw.name));
		}
	});

	it('tells a conference and a course from the meetings', () => {
		expect(mapCategory('Bømlakonferansen 2026')).toBe('konferanse');
		expect(mapCategory('Styrekurs del 1- i regi av Atheno')).toBe('kurs');
		expect(mapCategory('Frukostmøte hos Siemens Energy')).toBe('mote');
	});
});
