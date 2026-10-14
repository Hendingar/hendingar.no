import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseItems, parseProgram } from '../src/api.ts';
import { isFailure, isSkip, mapCard, startOf, type MappedEvent } from '../src/map.ts';

const html = readFileSync(new URL('./fixtures/program.html', import.meta.url), 'utf8');
const items = parseItems(
	JSON.parse(readFileSync(new URL('./fixtures/program_items.json', import.meta.url), 'utf8'))
);
const program = parseProgram(html);
const mapped = program.cards.map((card) =>
	mapCard(
		card,
		items.find((item) => item.link === card.link)
	)
);
const events = mapped.filter((m): m is MappedEvent => !isFailure(m) && !isSkip(m));
const byTitle = (title: string) => events.find((e) => e.title === title);

describe('the programme page', () => {
	it('reads every card, and refuses none', () => {
		expect(program.cards).toHaveLength(17);
		expect(program.rejected).toEqual([]);
	});

	it('skips the festival pass, which has a date and no clock', () => {
		const skipped = mapped.filter(isSkip);
		expect(skipped.map((s) => s.title)).toEqual(['Festivalpass 2026']);
		expect(mapped.filter(isFailure)).toEqual([]);
		expect(events).toHaveLength(16);
	});

	it('throws on a page with no cards, rather than importing nothing', () => {
		expect(() => parseProgram('<html><body>Ny design</body></html>')).toThrow(/program-card/);
	});
});

describe('times', () => {
	it('agrees with the clock printed on every card', () => {
		for (const card of program.cards) {
			if (!card.clock) continue;
			const stamped = card.datetime.split(' ')[1]!.padStart(5, '0');
			expect(card.clock.padStart(5, '0'), card.title).toBe(stamped);
		}
	});

	it('resolves the wall clock in Oslo, across the change to winter time', () => {
		// 29 October is after the clocks go back: 19:30 CET is 18:30Z.
		expect(byTitle('Salmar på Falturiltu – ein hyllest til Kenneth Sivertsen')?.startsAt).toEqual(
			new Date('2026-10-29T18:30:00Z')
		);
		// A single-digit hour, "9:50".
		expect(byTitle('Falturiltuseminaret')?.startsAt).toEqual(new Date('2026-11-05T08:50:00Z'));
	});

	it('prefers the printed clock when the stamp disagrees', () => {
		const start = startOf({
			link: 'https://falturiltu.no/arrangement/x/',
			title: 'X',
			datetime: '2026-10-30 18:00',
			clock: '19:00',
			venue: null,
			price: null,
			ticketUrl: null
		});
		expect(start?.instant).toEqual(new Date('2026-10-30T18:00:00Z'));
	});
});

describe('one event', () => {
	it('carries its venue, ticket link, description and own page', () => {
		const lunsj = byTitle('Litterær lunsj med Anders Totland');
		expect(lunsj).toMatchObject({
			externalId: 'litteraer-lunsj-med-anders-totland@2026-10-29',
			venueName: 'Stord VGS konsertsalen',
			category: 'festival',
			sourceUrl: 'https://falturiltu.no/arrangement/litteraer-lunsj-med-anders-totland/'
		});
		expect(lunsj?.description).toMatch(/^Tilrettelagt opplæring ved Stord VGS/);
		expect(byTitle('SYMRE')?.ctaUrl).toMatch(/^https:\/\/ebillett\.no\/stordkulturhus\/\d+$/);
	});

	it('decodes the quotation marks WordPress writes as entities', () => {
		expect(events.some((e) => e.title.startsWith('«Kor går streken» – utstillingsopning'))).toBe(
			true
		);
		for (const e of events) expect(e.title, e.title).not.toMatch(/&[a-z]+;/);
	});

	it('files the seminars as conferences', () => {
		expect(byTitle('Falturiltuseminaret')?.category).toBe('konferanse');
	});

	it('keys every row on its slug and day, uniquely', () => {
		const keys = events.map((e) => e.externalId);
		expect(new Set(keys).size).toBe(keys.length);
		for (const key of keys) expect(key).toMatch(/^[a-z0-9-]+@\d{4}-\d{2}-\d{2}$/);
	});
});
