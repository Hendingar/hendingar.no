import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { parseYear } from '../src/api.ts';
import {
	clocksFrom,
	externalIdFor,
	isFailure,
	mapCategory,
	mapEvent,
	monthNumber
} from '../src/map.ts';

/**
 * Against a committed real response. No network, no clock (CLAUDE.md rule 6).
 *
 * The fixture is what the year endpoint answered for 2026, trimmed to its first three month blocks
 * — real markup, including the CMS's own misspelled `loacation-text` class.
 */
const fixture = JSON.parse(
	readFileSync(fileURLToPath(new URL('./fixtures/aktivitetar-2026.json', import.meta.url)), 'utf8')
);
const parsed = parseYear(fixture);

describe('parseYear', () => {
	it('reads every card in the response', () => {
		expect(parsed.rows.length).toBe(12);
		expect(parsed.rejected).toEqual([]);
	});

	it('takes the year from the month heading, which is the only place it is written', () => {
		/*
		 * The whole reason this importer posts to the year endpoint instead of reading the page.
		 * On the page itself a card says "16 oktober" and nothing else — not on the card, not on
		 * the event's own page — so resolving it against today would be a guess that is wrong for a
		 * fortnight every December.
		 */
		expect(new Set(parsed.rows.map((r) => r.year))).toEqual(new Set([2026]));
	});

	it('refuses every card under a heading with no year, rather than inventing one', () => {
		// This is what the page's own markup looks like: "Oktober", no year. If we are ever reading
		// that by mistake, the run must report it rather than import a guess.
		const { rows, rejected } = parseYear([
			1,
			'<div class="month-block"><div class="main-month small-title">Oktober</div>' +
				'<div class="act-unit"><a href="?noko-1"><h2>Noko</h2>' +
				'<section class="month">oktober</section><section class="big">16</section></a></div></div>'
		]);
		expect(rows).toEqual([]);
		expect(rejected[0]).toMatch(/no year/);
	});

	it('throws when the envelope is not the one this endpoint answers with', () => {
		expect(() => parseYear({ data: [] })).toThrow(/unexpected/);
		expect(() => parseYear(['0'])).toThrow(/unexpected/);
	});

	it('reads the fields out of one card', () => {
		const card = parsed.rows[0]!;
		expect(card.id).toBe('23982');
		expect(card.title).toBe('Frukostmøte Aker Solutions - Eit verft i utvikling');
		expect(card.day).toBe('08');
		expect(card.month).toBe('januar');
		expect(card.time).toBe('08:00 - 09:50');
		expect(card.venue).toBe('Stord Hotell - Valhall');
		expect(card.imageUrl).toMatch(/^https:\/\/s16\.getynet\.com\/.+\.jpg$/);
	});
});

describe('a card that links to a mailto instead of a page', () => {
	/*
	 * Two of the twelve are sign-up-by-email activities with no page and no id — "Berekraftnettverket
	 * i Sunnhordland" is one. They are real, so they are imported rather than reported as the source
	 * having moved; what they need is a key, and the title with the day is the only stable thing the
	 * card carries.
	 */
	const mailto = parsed.rows.find((r) => r.title.includes('Berekraftnettverket'))!;

	it('is read rather than refused', () => {
		expect(mailto).toBeDefined();
		expect(mailto.id).toBe('');
		expect(parsed.rejected).toEqual([]);
	});

	it('gets a key from the title and the day, never from the start instant', () => {
		const mapped = mapEvent(mailto);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.externalId).toBe('t-berekraftnettverket-i-sunnhordland-2026-02-03');
		// Re-timing it keeps the key, so the row updates instead of being abandoned.
		expect(mapEvent({ ...mailto, time: '15:00 - 16:30' })).toMatchObject({
			externalId: mapped.externalId
		});
	});

	it('sends the reader to the calendar, since it has no page of its own', () => {
		const mapped = mapEvent(mailto);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.sourceUrl).toBe(
			'https://www.snr.no/Arrayliste/aktiviteterliste/aktivitetskalender'
		);
	});

	it('leaves the CMS id alone where there is one', () => {
		expect(externalIdFor(parsed.rows[0]!, '2026-01-08')).toBe('23982');
	});
});

describe('mapEvent', () => {
	it('maps every card in the fixture without a rejection', () => {
		for (const card of parsed.rows) {
			const mapped = mapEvent(card);
			expect(isFailure(mapped) ? mapped.problem : null).toBeNull();
		}
	});

	it('resolves the wall clock in Stord’s zone, not the server’s', () => {
		/*
		 * The card states a wall clock and no offset, which is the honest shape for a local
		 * calendar. January is CET: 08:00 local is 07:00Z. A fixed offset would be an hour wrong
		 * for half the year, and `new Date()` would be right only on a laptop in Norway.
		 */
		const mapped = mapEvent(parsed.rows[0]!);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.startsAt.toISOString()).toBe('2026-01-08T07:00:00.000Z');
		expect(mapped.endsAt!.toISOString()).toBe('2026-01-08T08:50:00.000Z');
	});

	it('keys on the CMS id, never on the date', () => {
		// A re-timed activity has to update in place rather than insert a second row — the lesson
		// written into importers/mec.
		const mapped = mapEvent(parsed.rows[0]!);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.externalId).toBe('23982');
		expect(mapped.sourceUrl).toContain('frukostmote-aker-solutions-eit-verft-i-utvikling-23982');
	});

	it('hotlinks the card’s picture and claims no rights to it', () => {
		const withPoster = parsed.rows.map(mapEvent).filter((m) => !isFailure(m) && m.posterUrl);
		expect(withPoster.length).toBeGreaterThan(0);
		for (const mapped of withPoster) {
			if (isFailure(mapped)) continue;
			expect(mapped.posterUrl).toMatch(/^https:\/\//);
			expect(mapped.posterRightsVerified).toBe(false);
		}
	});

	it('drops an end that is not after the start rather than guessing past midnight', () => {
		const mapped = mapEvent({
			...parsed.rows[0]!,
			time: '18:00 - 02:00'
		});
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.endsAt).toBeNull();
	});

	it('refuses a month it does not know', () => {
		const mapped = mapEvent({ ...parsed.rows[0]!, month: 'haust' });
		expect(isFailure(mapped)).toBe(true);
	});
});

describe('clocksFrom', () => {
	it('reads both clocks, however the card separates them', () => {
		expect(clocksFrom('08:00 - 09:50')).toEqual({ start: '08:00', end: '09:50' });
		expect(clocksFrom('11:30 – 14:00')).toEqual({ start: '11:30', end: '14:00' });
		expect(clocksFrom('9.00')).toEqual({ start: '09:00', end: null });
	});

	it('is empty for a card with no time at all', () => {
		expect(clocksFrom(null)).toEqual({ start: null, end: null });
		expect(clocksFrom('heile dagen')).toEqual({ start: null, end: null });
	});
});

describe('monthNumber and mapCategory', () => {
	it('knows the months the CMS writes, whatever the case', () => {
		expect(monthNumber('januar')).toBe(1);
		expect(monthNumber('Desember')).toBe(12);
		expect(monthNumber('haust')).toBeNull();
	});

	it('only ever returns a slug in our taxonomy', () => {
		for (const card of parsed.rows) {
			expect(CATEGORY_SLUGS).toContain(mapCategory(card.title));
		}
		expect(mapCategory('Stordkonferansen 2026')).toBe('konferanse');
		expect(mapCategory('Miniseminar på Utdanningsmessa')).toBe('kurs');
		expect(mapCategory('Lunchmøte med Sparebank 1')).toBe('mote');
	});
});
