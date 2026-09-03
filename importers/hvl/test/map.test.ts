import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { eventTypes, MONTHS_AHEAD, monthsFrom, parseMonth, parsePoster } from '../src/api.ts';
import { CAMPUSES, calendarUrl, campusBySlug, monthUrl } from '../src/campuses.ts';
import { isAtCampus, isFailure, mapCategory, mapEvent, slugifyVenue } from '../src/map.ts';

/**
 * Against committed real responses. No network, no clock (CLAUDE.md rule 6).
 */
const read = (name: string) =>
	readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const fixture = (name: string): unknown => JSON.parse(read(name));

const stord = campusBySlug('hvl-stord')!;
const september = parseMonth(fixture('month-stord-2026-09.json'));
const october = parseMonth(fixture('month-stord-2026-10.json'));

describe('parseMonth', () => {
	it('keeps only what the service marked for this campus', () => {
		// The service answers for the whole institution and marks the matches: fifty-four September
		// rows, thirteen of them Stord's. Taking every item would import the national calendar.
		expect(september.events).toHaveLength(13);
		expect(september.otherCampus).toBe(41);
		expect(september.rejected).toEqual([]);
	});

	it('throws when the response is not a month at all', () => {
		// A redesign that moves the service must fail loudly, not import zero events and report
		// success — that is the failure mode /datasamling exists to make visible.
		expect(() => parseMonth('<html>')).toThrow(/unexpected/);
	});

	it('rejects a malformed item without losing the rest of the month', () => {
		const parsed = parseMonth({
			items: [
				{ title: 'ok', startDateTime: '2026-09-03T11:15:00+00:00', visible: true },
				{ title: 42, visible: true }
			]
		});
		expect(parsed.events).toHaveLength(1);
		expect(parsed.rejected).toHaveLength(1);
	});
});

describe('isAtCampus', () => {
	it('drops events merely tagged with the campus', () => {
		/*
		 * The whole reason this importer needs a location rule. HVL tags an all-institution event
		 * with every campus, so the Stord filter returns the doctoral ceremony in Bergen, the board
		 * meeting in Førde and every Zoom webinar.
		 */
		const here = september.events.filter((e) => isAtCampus(e, stord));
		const addresses = september.events.map((e) => e.adress);

		expect(addresses).toContain('Campus Bergen, Mimes Brønn');
		expect(addresses).toContain('Webinar');
		expect(here.length).toBeLessThan(september.events.length);
		for (const event of here) {
			expect(event.adress).toMatch(/stord|rommetveit/i);
		}
	});

	it('keeps the campus’s own rooms, library and village', () => {
		const keep = ['Campus Stord', 'Stord, biblioteket ', 'UND 146, Rommetveit, campus Stord'];
		for (const adress of keep) {
			expect(
				isAtCampus({ title: 't', startDateTime: '2026-09-03T09:00:00+00:00', adress }, stord)
			).toBe(true);
		}
	});

	it('does not match a bare library, because every campus has one', () => {
		expect(
			isAtCampus(
				{ title: 't', startDateTime: '2026-09-03T09:00:00+00:00', adress: 'Biblioteket' },
				stord
			)
		).toBe(false);
	});

	it('drops a row with no address at all rather than guessing it is local', () => {
		expect(isAtCampus({ title: 't', startDateTime: '2026-09-03T09:00:00+00:00' }, stord)).toBe(
			false
		);
		expect(
			isAtCampus({ title: 't', startDateTime: '2026-09-03T09:00:00+00:00', adress: '  ' }, stord)
		).toBe(false);
	});
});

describe('mapEvent', () => {
	const here = september.events.filter((e) => isAtCampus(e, stord));

	it('reads the instant, not the wall clock stamped with a UTC offset', () => {
		/*
		 * The trap this importer exists to avoid. The service sends both
		 *   startDateTime:     2026-09-03T11:15:00+00:00   (the real instant, 13:15 in Oslo)
		 *   startFullDateTime: 2026-09-03T13:15+00:00      (Oslo's wall clock, mislabelled)
		 * Parsing the second moves every event two hours later in summer, and looks correct in a
		 * spot check because the digits match the poster.
		 */
		const raw = september.events.find((e) => e.title.includes('Innføring i KI'))!;
		expect(raw.startDateTime).toBe('2026-09-03T11:15:00+00:00');
		const mapped = mapEvent(raw, stord, null);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.startsAt.toISOString()).toBe('2026-09-03T11:15:00.000Z');
	});

	it('maps every Stord event without a rejection', () => {
		expect(here.length).toBeGreaterThan(0);
		for (const raw of [...here, ...october.events.filter((e) => isAtCampus(e, stord))]) {
			const mapped = mapEvent(raw, stord, null);
			expect(isFailure(mapped) ? mapped.problem : null).toBeNull();
		}
	});

	it('links to the event’s own page, which HVL actually serves', () => {
		const mapped = mapEvent(here[0]!, stord, null);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.sourceUrl).toMatch(/^https:\/\/www\.hvl\.no\/kalender\/.+/);
		expect(mapped.externalId).toMatch(/^\/kalender\//);
	});

	it('rejects a row with no page, rather than inventing an identity from the title', () => {
		const mapped = mapEvent(
			{ title: 'x', startDateTime: '2026-09-03T11:15:00+00:00' },
			stord,
			null
		);
		expect(isFailure(mapped)).toBe(true);
	});

	it('rejects an unparseable start', () => {
		const mapped = mapEvent(
			{ title: 'x', startDateTime: 'til hausten', url: '/kalender/x/' },
			stord,
			null
		);
		expect(isFailure(mapped)).toBe(true);
	});

	it('drops an end that is not after the start', () => {
		const mapped = mapEvent(
			{
				title: 'x',
				url: '/kalender/x/',
				startDateTime: '2026-09-03T11:15:00+00:00',
				endDateTime: '2026-09-03T11:15:00+00:00'
			},
			stord,
			null
		);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.endsAt).toBeNull();
	});

	it('never claims rights to a banner HVL says nothing about', () => {
		const mapped = mapEvent(here[0]!, stord, 'https://www.hvl.no/contentassets/x.png');
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.posterRightsVerified).toBe(false);
	});
});

describe('mapCategory', () => {
	it('only ever returns a slug in our taxonomy', () => {
		const vocabulary = [
			'Disputas',
			'Konferanse',
			'Debatt',
			'Presentasjon',
			'Kulturarrangement',
			'Forskingsdagane',
			'Styremøte',
			'Kurs',
			'Noe helt nytt'
		];
		for (const type of vocabulary) expect(CATEGORY_SLUGS).toContain(mapCategory([type]));
	});

	it('folds the Norwegian letters, so Styremøte is a meeting', () => {
		expect(mapCategory(['Styremøte'])).toBe('mote');
	});

	it('reads the type tags without the campus tags', () => {
		const raw = september.events.find((e) => eventTypes(e).length > 0)!;
		expect(eventTypes(raw)).not.toContain('Stord');
		expect(eventTypes(raw)).not.toContain('Bergen');
	});

	it('falls back to anna when the tag names no category of ours', () => {
		// "Kulturarrangement" could be a concert, a reading or an exhibition. Picking one would be
		// inventing a fact the source never stated.
		expect(mapCategory(['Kulturarrangement'])).toBe('anna');
		expect(mapCategory([])).toBe('anna');
	});
});

describe('parsePoster', () => {
	it('reads the banner off a real detail page', () => {
		const poster = parsePoster(read('detail-forskningsdagene-stord.html'));
		expect(poster).toMatch(/^https:\/\/www\.hvl\.no\/contentassets\/.+\.(png|jpg|jpeg)$/i);
	});

	it('normalises the doubled slash HVL writes', () => {
		expect(
			parsePoster('<meta property="og:image" content="https://www.hvl.no//contentassets/a.png">')
		).toBe('https://www.hvl.no/contentassets/a.png');
	});

	it('returns null rather than a broken URL when the tag is missing', () => {
		expect(parsePoster('<html><head></head></html>')).toBeNull();
		expect(parsePoster('<meta property="og:image" content="javascript:alert(1)">')).toBeNull();
	});
});

describe('monthsFrom', () => {
	it('walks a year of months forward from the given date', () => {
		const months = monthsFrom(new Date('2026-11-15T12:00:00Z'));
		expect(months).toHaveLength(MONTHS_AHEAD);
		expect(months[0]).toEqual({ year: 2026, month: 11 });
		expect(months[1]).toEqual({ year: 2026, month: 12 });
		// Rolls the year rather than asking for month 13.
		expect(months[2]).toEqual({ year: 2027, month: 1 });
	});

	it('does not shift by a month depending on where the job runs', () => {
		// Built in UTC on purpose: `new Date(2026, 0, 1)` on a machine west of Greenwich lands in
		// December, and the scheduled job would quietly skip a month.
		expect(monthsFrom(new Date('2026-01-01T00:30:00Z'))[0]).toEqual({ year: 2026, month: 1 });
	});
});

describe('campuses', () => {
	it('gives every campus a distinct slug and location id', () => {
		expect(new Set(CAMPUSES.map((c) => c.slug)).size).toBe(CAMPUSES.length);
		expect(new Set(CAMPUSES.map((c) => c.locationId)).size).toBe(CAMPUSES.length);
	});

	it('builds the URLs the reader and the job actually use', () => {
		expect(calendarUrl(stord)).toBe('https://www.hvl.no/kalender/?filters=,Stord');
		expect(monthUrl(stord, 2026, 9)).toBe(
			'https://www.hvl.no/service/calendar/month/nn-NO/2026/9/0/Stord'
		);
	});
});

describe('slugifyVenue', () => {
	it('folds Norwegian letters before stripping accents', () => {
		expect(slugifyVenue('Høgskulen på Vestlandet, campus Stord')).toBe(
			'hoegskulen-paa-vestlandet-campus-stord'
		);
	});
});
