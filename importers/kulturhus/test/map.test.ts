import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { INSTANCES, extractEvents, instanceBySlug } from '../src/api.ts';
import { isFailure, mapCategory, mapEvents, mapTicket, splitLocalDateTime } from '../src/map.ts';

/**
 * Against committed real page data. No network (CLAUDE.md rule 6).
 */
const payload = JSON.parse(
	readFileSync(
		fileURLToPath(new URL('./fixtures/stord-kulturprogram.json', import.meta.url)),
		'utf8'
	)
);
const instance = instanceBySlug('stord-kulturhus')!;
const upstream = extractEvents(payload);
const mapped = mapEvents(upstream, instance);

describe('extractEvents', () => {
	it('finds the programme inside Gatsby page data', () => {
		expect(upstream.length).toBeGreaterThan(40);
	});

	it('matches the block on shape, not on its component name', () => {
		// A rename upstream must not silently return zero events: the name is a label, the `events`
		// array is the contract.
		const renamed = structuredClone(payload);
		for (const block of renamed.result.pageContext.blocks) block.component = 'cw-component-renamed';
		expect(extractEvents(renamed).length).toBe(upstream.length);
	});

	it('throws when the programme block is gone, rather than importing nothing', () => {
		const stripped = structuredClone(payload);
		stripped.result.pageContext.blocks = [
			{ component: 'cw-component-cover', data: { title: 'x' } }
		];
		expect(() => extractEvents(stripped)).toThrow(/no programme block/);
	});

	it('throws on page data of an unexpected shape', () => {
		expect(() => extractEvents({ nope: true })).toThrow(/unexpected page-data shape/);
	});
});

describe('mapEvents', () => {
	it('maps every showing without failures', () => {
		expect(mapped.filter(isFailure)).toEqual([]);
	});

	it('imports one row per showing, not one per programme entry', () => {
		/*
		 * The whole reason tickets are expanded. Public swimming runs fourteen times and a reading
		 * circle monthly; importing the parent entry would collapse those into a single row whose
		 * date moved every time the importer ran.
		 */
		expect(mapped.length).toBeGreaterThan(upstream.length);
		const withMany = upstream.filter((e) => (e.tickets?.length ?? 0) > 1);
		expect(withMany.length, 'the fixture should contain a repeating event').toBeGreaterThan(0);
	});

	it('gives every showing its own stable id', () => {
		const ids = mapped.filter((m) => !isFailure(m)).map((m) => !isFailure(m) && m.externalId);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('keeps each showing in its own room', () => {
		const venues = new Set(
			mapped.filter((m) => !isFailure(m)).map((m) => (!isFailure(m) ? m.venueName : ''))
		);
		// Biblioteket, Storsalen, Osvald Pub, Symjehallen… one address for all of them would make
		// the map useless later.
		expect(venues.size).toBeGreaterThan(3);
	});

	it('falls back to the parent start when a programme entry has no showings yet', () => {
		// A concert announced before ticket sale opens looks exactly like this, and dropping it
		// would hide next season.
		const parent = { ...upstream[0]!, tickets: [], begin: '2027-03-01 19:00:00', id: 'no-tickets' };
		const out = mapEvents([parent], instance);
		expect(out).toHaveLength(1);
		expect(isFailure(out[0]!)).toBe(false);
	});

	it('rejects an entry with neither showings nor a start', () => {
		const parent = { ...upstream[0]!, tickets: [], begin: null, id: 'empty' };
		const out = mapEvents([parent], instance);
		expect(isFailure(out[0]!)).toBe(true);
	});
});

describe('times', () => {
	it('splits the payload format', () => {
		expect(splitLocalDateTime('2026-09-03 11:00:00')).toEqual(['2026-09-03', '11:00']);
		expect(splitLocalDateTime('nope')).toBeNull();
	});

	it('resolves a summer wall clock in the venue zone', () => {
		const m = mapTicket(
			upstream[0]!,
			{ id: 't1', date: '2026-09-03 11:00:00', location: null, link: null },
			instance
		);
		if (isFailure(m)) throw new Error('should have mapped');
		expect(m.startsAt.toISOString()).toBe('2026-09-03T09:00:00.000Z');
	});

	it('resolves a winter wall clock an hour differently', () => {
		// CET, not CEST. A single-pass offset lookup lands on the wrong side near the boundary.
		const m = mapTicket(
			upstream[0]!,
			{ id: 't2', date: '2026-12-16 19:00:00', location: null, link: null },
			instance
		);
		if (isFailure(m)) throw new Error('should have mapped');
		expect(m.startsAt.toISOString()).toBe('2026-12-16T18:00:00.000Z');
	});
});

describe('links', () => {
	it('points the reader at the programme page, not the checkout', () => {
		const m = mapped.find((x) => !isFailure(x) && x.sourceUrl.includes('stord.kulturhus.no'));
		expect(m, 'a showing should link back to the venue').toBeTruthy();
		// We are an index, not a box office: the ticket link is the CTA, the event page is the source.
		if (m && !isFailure(m)) expect(m.sourceUrl).not.toMatch(/checkout\./);
	});

	it('keeps the ticket link as the call to action where there is one', () => {
		const withCta = mapped.filter((m) => !isFailure(m) && m.ctaUrl);
		expect(withCta.length).toBeGreaterThan(0);
	});
});

describe('mapCategory', () => {
	it('honours the venue’s own category names', () => {
		expect(mapCategory('Konsert')).toBe('musikk');
		expect(mapCategory('Standup')).toBe('stand-up');
		expect(mapCategory('Litteratur')).toBe('litteratur');
		expect(mapCategory('Musikal')).toBe('teater');
	});

	it('reads a swim session as sport, not as a performance', () => {
		expect(mapCategory('Offentleg bading')).toBe('sport');
	});

	it('reads Falturiltu as the festival it is', () => {
		expect(mapCategory('Falturiltu')).toBe('festival');
	});

	it('falls back to anna for an unknown or missing category', () => {
		expect(mapCategory('Noko heilt nytt')).toBe('anna');
		expect(mapCategory(null)).toBe('anna');
	});

	it('only ever returns a slug that exists in the taxonomy', () => {
		for (const e of upstream) expect(CATEGORY_SLUGS).toContain(mapCategory(e.category));
	});

	it('maps most of the fixture to something better than anna', () => {
		const cats = mapped
			.filter((m) => !isFailure(m))
			.map((m) => (!isFailure(m) ? m.category : 'anna'));
		const anna = cats.filter((c) => c === 'anna').length;
		expect(anna / cats.length, 'the venue names its categories; we should use them').toBeLessThan(
			0.2
		);
	});
});

describe('instances', () => {
	it('has unique slugs', () => {
		const slugs = INSTANCES.map((i) => i.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});
});
