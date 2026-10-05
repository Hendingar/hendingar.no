import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { formatEventTime } from '@hendingar/core/datetime';
import { parseEntry, parseListing, type ListingItem } from '../src/api.ts';
import {
	absoluteSrcset,
	isFailure,
	mapEvent,
	occurrenceId,
	parseDateLine,
	sameDateLine,
	toInstants,
	venueFrom
} from '../src/map.ts';

/**
 * Against committed real responses, fetched once on 2026-10-05. No network, no clock (CLAUDE.md
 * rule 6).
 *
 * The listing as served, and every entry it linked that day — three, not two: the handarbeidskafé
 * is two articles, one per evening, and the older one is still addressed by Sitevision's
 * `<name>.5.<id>.html` path shape. Between them they carry both date-line forms the calendar uses
 * (a day with a clock, a span of days with none), an entry with a `Stad:` line and one without.
 */
function fixture(name: string): string {
	return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

const listing = parseListing(fixture('kva-skjer-i-fitjar.html'));
const entries: Record<string, string> = {
	'5.796b7291a0ad9e1e6d4d05': 'entry-haustferie---aktivitet-for-ungdom.html',
	'5.1a2db2a419ed4320d6e1ec97': 'entry-handarbeidskafe-2026-10-27.html',
	'5.1a2db2a419ed4320d6e1eca4': 'entry-handarbeidskafe-2026-11-24.html'
};

function item(id: string): ListingItem {
	const row = listing.rows.find((r) => r.id === id);
	if (!row) throw new Error(`no listing row ${id}`);
	return row;
}

function mapped(id: string) {
	const file = entries[id];
	if (!file) throw new Error(`no fixture for ${id}`);
	const result = mapEvent(item(id), parseEntry(fixture(file)));
	if (isFailure(result)) throw new Error(result.problem);
	return result;
}

describe('parseListing', () => {
	it('reads the list app’s own state, every row of it', () => {
		expect(listing.rejected).toEqual([]);
		expect(listing.rows.map((r) => r.id)).toEqual([
			'5.796b7291a0ad9e1e6d4d05',
			'5.1a2db2a419ed4320d6e1ec97',
			'5.1a2db2a419ed4320d6e1eca4'
		]);
		expect(item('5.1a2db2a419ed4320d6e1eca4')).toMatchObject({
			articleName: 'Fitjar Husflidslags handarbeidskafé',
			URI: '/kva-skjer-i-fitjar/kva-skjer-i-fitjar/2026-08-07-fitjar-husflidslags-handarbeidskafe',
			eventDate: '24. november 2026, 18.00'
		});
	});

	it('picks the list app out from the menu apps that hydrate on the same page', () => {
		// The page registers several states; only the nkm-event-list one has `items` of this shape.
		expect(listing.rows.every((r) => r.URI.startsWith('/'))).toBe(true);
	});

	it('throws when the app or its state is gone, rather than importing nothing', () => {
		/*
		 * A redesign must fail loudly. Returning zero events would be reported as a clean run on
		 * /datasamling, which is exactly the silent stop that page exists to make visible.
		 */
		expect(() => parseListing('<html><body>Kva skjer i Fitjar?</body></html>')).toThrow(
			/nkm-event-list/
		);
		const app =
			"<script>AppRegistry.registerApp({applicationId:'marketplace.sitevision.nkm-event-list|0.1.6',portletId:'12.abc'});</script>";
		expect(() => parseListing(app)).toThrow(/no initial state/);
		expect(() =>
			parseListing(`${app}<script>AppRegistry.registerInitialState('12.abc',{oops});</script>`)
		).toThrow(/not JSON/);
		expect(() =>
			parseListing(`${app}<script>AppRegistry.registerInitialState('12.abc',{"x":1});</script>`)
		).toThrow(/unexpected/);
	});

	it('refuses a row that would send the importer to another host', () => {
		const app =
			"<script>AppRegistry.registerApp({applicationId:'marketplace.sitevision.nkm-event-list|0.1.6',portletId:'12.abc'});</script>";
		const state = JSON.stringify({
			items: [
				{ id: '5.abc', articleName: 'A', URI: 'https://example.com/a', eventDate: '1. mai 2027' },
				{ id: '5.def', articleName: 'B', URI: '//example.com/b', eventDate: '1. mai 2027' },
				{ id: '5.123', articleName: 'C', URI: '/c', eventDate: '1. mai 2027' }
			]
		});
		const parsed = parseListing(
			`${app}<script>AppRegistry.registerInitialState('12.abc',${state});</script>`
		);
		expect(parsed.rows.map((r) => r.id)).toEqual(['5.123']);
		expect(parsed.rejected).toHaveLength(2);
	});
});

describe('parseEntry', () => {
	it('reads what a reader sees on the entry', () => {
		const entry = parseEntry(fixture('entry-handarbeidskafe-2026-11-24.html'));
		expect(entry).toMatchObject({
			dateText: '24. november 2026, 18.00',
			title: 'Fitjar Husflidslags handarbeidskafé',
			// `Fitjar<span>tun 2. høgda.</span>` — joined, as the browser renders it.
			preamble: 'Stad: Fitjartun 2. høgda.',
			body: null
		});
		expect(entry.image?.src).toBe(
			'/images/18.1a2db2a419ed4320d6e1ec7e/1786098016047/Handarbeidskafe.png'
		);
	});

	it('reads a span of days with no clock exactly as printed', () => {
		const entry = parseEntry(fixture('entry-haustferie---aktivitet-for-ungdom.html'));
		expect(entry.dateText).toBe('6.–8. oktober 2026');
		expect(entry.preamble).toBe(
			'Friluftsrådet Vest arrangerar artige aktivitetar for ungdom i Sunnhordland i haustferien!'
		);
	});

	it('agrees with the card on every entry', () => {
		// Two renderings of one stored value. The run reports it the day they stop agreeing.
		for (const [id, file] of Object.entries(entries)) {
			expect(sameDateLine(parseEntry(fixture(file)).dateText, item(id).eventDate)).toBe(true);
		}
	});

	it('throws on a page that is not an entry — the listing itself, for one', () => {
		// The listing has a heading, so a heading alone must not be enough to pass.
		expect(() => parseEntry(fixture('kva-skjer-i-fitjar.html'))).toThrow(/nkm-event-date/);
	});
});

describe('parseDateLine', () => {
	it('reads both forms the calendar uses today', () => {
		expect(parseDateLine('24. november 2026, 18.00')).toEqual({
			startDate: '2026-11-24',
			startTime: '18:00',
			endDate: null,
			endTime: null
		});
		expect(parseDateLine('6.–8. oktober 2026')).toEqual({
			startDate: '2026-10-06',
			startTime: null,
			endDate: '2026-10-08',
			endTime: null
		});
	});

	it('reads the other shapes a date line is written in', () => {
		expect(parseDateLine('24. november 2026')).toMatchObject({
			startDate: '2026-11-24',
			startTime: null
		});
		expect(parseDateLine('24. november 2026, 18.00–20.30')).toEqual({
			startDate: '2026-11-24',
			startTime: '18:00',
			endDate: null,
			endTime: '20:30'
		});
		expect(parseDateLine('30. september – 2. oktober 2026')).toMatchObject({
			startDate: '2026-09-30',
			endDate: '2026-10-02'
		});
		expect(parseDateLine('24. november 2026, 18.00 – 25. november 2026, 02.00')).toEqual({
			startDate: '2026-11-24',
			startTime: '18:00',
			endDate: '2026-11-25',
			endTime: '02:00'
		});
	});

	it('gives a span across new year the far side’s year, less one', () => {
		expect(parseDateLine('30. desember – 2. januar 2027')).toMatchObject({
			startDate: '2026-12-30',
			endDate: '2027-01-02'
		});
	});

	it('refuses what it cannot read, instead of guessing', () => {
		expect(parseDateLine('31. september 2026')).toBeNull(); // not a day
		expect(parseDateLine('24. novembar 2026')).toBeNull(); // not a month
		expect(parseDateLine('24. november 2026, 25.00')).toBeNull(); // not a clock
		expect(parseDateLine('24. november')).toBeNull(); // no year
		expect(parseDateLine('til hausten')).toBeNull();
		expect(parseDateLine('')).toBeNull();
		expect(parseDateLine('8.–6. oktober 2026')).toBeNull(); // ends before it starts
	});

	it('refuses a span whose only clock is on its far side', () => {
		// A start every evening, or the hour the last day ends? Not on the page; not ours to choose.
		expect(parseDateLine('6.–8. oktober 2026, 18.00')).toBeNull();
	});
});

describe('toInstants', () => {
	const zone = 'Europe/Oslo';

	it('resolves the wall clock in the venue’s zone, on both sides of the clock change', () => {
		/*
		 * The two handarbeidskafé evenings are both 18.00 and both after summer time ends on
		 * 25 October 2026, so both are 17:00Z. A June evening at 18.00 is 16:00Z. A fixed `+02:00`
		 * would have put the November café at 19:00.
		 */
		expect(toInstants(parseDateLine('27. oktober 2026, 18.00')!, zone).startsAt.toISOString()).toBe(
			'2026-10-27T17:00:00.000Z'
		);
		expect(
			toInstants(parseDateLine('24. november 2026, 18.00')!, zone).startsAt.toISOString()
		).toBe('2026-11-24T17:00:00.000Z');
		expect(toInstants(parseDateLine('24. juni 2026, 18.00')!, zone).startsAt.toISOString()).toBe(
			'2026-06-24T16:00:00.000Z'
		);
	});

	it('states no end when the page states none', () => {
		expect(toInstants(parseDateLine('24. november 2026, 18.00')!, zone).endsAt).toBeNull();
	});

	it('stores a day with no clock as the whole day, never an invented hour', () => {
		// The bakhagen encoding: local 00:00 to local 23:59:59, to the last second of the last day.
		const { startsAt, endsAt } = toInstants(parseDateLine('6.–8. oktober 2026')!, zone);
		expect(startsAt.toISOString()).toBe('2026-10-05T22:00:00.000Z');
		expect(endsAt?.toISOString()).toBe('2026-10-08T21:59:59.000Z');
	});

	it('reads an end earlier than its start as running past midnight', () => {
		const { endsAt } = toInstants(parseDateLine('24. november 2026, 22.00–01.00')!, zone);
		expect(endsAt?.toISOString()).toBe('2026-11-25T00:00:00.000Z');
	});
});

describe('venueFrom', () => {
	it('reads the place off the Stad: line, without its floor', () => {
		expect(venueFrom('Stad: Fitjartun 2. høgda.')).toBe('Fitjartun');
		expect(venueFrom('Stad: Fitjar kulturhus, 2. etasje')).toBe('Fitjar kulturhus');
		expect(venueFrom('Stad: Fitjar bedehus.')).toBe('Fitjar bedehus');
	});

	it('names no place when the page names none', () => {
		expect(venueFrom('Friluftsrådet Vest arrangerar artige aktivitetar for ungdom.')).toBeNull();
		expect(venueFrom(null, undefined)).toBeNull();
	});
});

describe('absoluteSrcset', () => {
	it('makes every candidate absolute, on the kommune’s own host', () => {
		expect(absoluteSrcset('/images/a/x160p/A.png 160w, /images/a/A.png 870w')).toBe(
			'https://www.fitjar.kommune.no/images/a/x160p/A.png 160w, https://www.fitjar.kommune.no/images/a/A.png 870w'
		);
	});

	it('drops the whole set rather than ship one with a hole in it', () => {
		expect(absoluteSrcset('/images/a.png 160w, https://elsewhere.example/b.png 320w')).toBeNull();
		expect(absoluteSrcset('/images/a.png')).toBeNull();
		expect(absoluteSrcset(null)).toBeNull();
	});
});

describe('mapEvent', () => {
	it('maps every listed entry without a rejection', () => {
		for (const [id, file] of Object.entries(entries)) {
			const result = mapEvent(item(id), parseEntry(fixture(file)));
			expect(isFailure(result) ? result.problem : null).toBeNull();
		}
	});

	it('takes the event’s day from the page, never from the slug', () => {
		/*
		 * The slug says 2026-08-07, `displayName` says [2026-08-07], and `publishDate` is
		 * 7 August: all three are the day the article was written. The café is on 24 November.
		 */
		const cafe = mapped('5.1a2db2a419ed4320d6e1eca4');
		expect(cafe.startsAt.toISOString()).toBe('2026-11-24T17:00:00.000Z');
		expect(formatEventTime(cafe.startsAt, 'Europe/Oslo')).toContain('18:00');
		expect(cafe.endsAt).toBeNull();

		// And the haustferie entry, whose slug says 30 September, is on 6–8 October.
		const haustferie = mapped('5.796b7291a0ad9e1e6d4d05');
		expect(haustferie.startsAt.toISOString()).toBe('2026-10-05T22:00:00.000Z');
		expect(haustferie.endsAt?.toISOString()).toBe('2026-10-08T21:59:59.000Z');
	});

	it('keys on the page id and the day, never on the instant or the slug', () => {
		expect(mapped('5.1a2db2a419ed4320d6e1eca4').externalId).toBe(
			'5.1a2db2a419ed4320d6e1eca4@2026-11-24'
		);
		expect(mapped('5.1a2db2a419ed4320d6e1ec97').externalId).toBe(
			'5.1a2db2a419ed4320d6e1ec97@2026-10-27'
		);
		expect(occurrenceId('5.abc', '2026-10-06')).toBe('5.abc@2026-10-06');

		// A re-timed entry keeps its key, so it updates in place rather than leaving a stale row.
		const retimed = mapEvent(item('5.1a2db2a419ed4320d6e1eca4'), {
			...parseEntry(fixture('entry-handarbeidskafe-2026-11-24.html')),
			dateText: '24. november 2026, 19.00'
		});
		if (isFailure(retimed)) throw new Error(retimed.problem);
		expect(retimed.externalId).toBe('5.1a2db2a419ed4320d6e1eca4@2026-11-24');
	});

	it('links to the entry’s own page, in whichever path shape it is addressed by', () => {
		expect(mapped('5.1a2db2a419ed4320d6e1eca4').sourceUrl).toBe(
			'https://www.fitjar.kommune.no/kva-skjer-i-fitjar/kva-skjer-i-fitjar/2026-08-07-fitjar-husflidslags-handarbeidskafe'
		);
		expect(mapped('5.1a2db2a419ed4320d6e1ec97').sourceUrl).toBe(
			'https://www.fitjar.kommune.no/kvaskjerifitjar/kvaskjerifitjar/fitjarhusflidslagshandarbeidskafe.5.1a2db2a419ed4320d6e1ec97.html'
		);
	});

	it('names the place the entry names, and none where it names none', () => {
		const cafe = mapped('5.1a2db2a419ed4320d6e1eca4');
		expect(cafe.venueName).toBe('Fitjartun');
		expect(cafe.venueSlug).toBe('fitjartun');
		// The floor is not in the place name, so it stays in the text it came from.
		expect(cafe.description).toBe('Stad: Fitjartun 2. høgda.');

		const haustferie = mapped('5.796b7291a0ad9e1e6d4d05');
		expect(haustferie.venueName).toBeNull();
		expect(haustferie.description).toContain('Friluftsrådet Vest');
	});

	it('hotlinks the full-size poster, every width of it, and claims no rights to it', () => {
		const cafe = mapped('5.1a2db2a419ed4320d6e1eca4');
		expect(cafe.posterUrl).toBe(
			'https://www.fitjar.kommune.no/images/18.1a2db2a419ed4320d6e1ec7e/1786098016047/Handarbeidskafe.png'
		);
		expect(cafe.posterSrcset).toMatch(/^https:\/\/www\.fitjar\.kommune\.no\/.*160w, .* 870w$/);
		expect(cafe.posterRightsVerified).toBe(false);
	});

	it('files everything under anna, because the kommune files nothing', () => {
		for (const id of Object.keys(entries)) {
			const result = mapped(id);
			expect(result.category).toBe('anna');
			expect(CATEGORY_SLUGS).toContain(result.category);
		}
	});

	it('degrades to the card when the entry cannot be read, without a place', () => {
		const result = mapEvent(item('5.1a2db2a419ed4320d6e1eca4'), null);
		if (isFailure(result)) throw new Error(result.problem);
		expect(result.startsAt.toISOString()).toBe('2026-11-24T17:00:00.000Z');
		// The card's flattened ingress says "Fitjar tun"; that is not a place name to store.
		expect(result.venueName).toBeNull();
		expect(result.title).toBe('Fitjar Husflidslags handarbeidskafé');
	});

	it('reports an unreadable date line by name instead of inventing one', () => {
		const result = mapEvent(
			{ ...item('5.796b7291a0ad9e1e6d4d05'), eventDate: 'Kvar tysdag i haust' },
			null
		);
		expect(isFailure(result) && result.problem).toBe('unreadable date line: Kvar tysdag i haust');
	});
});
