import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { parseListing, postIdFor } from '../src/api.ts';
import { INSTANCES, instanceBySlug } from '../src/instances.ts';
import { DEFAULT_CATEGORY, isFailure, mapEvent, occurrenceId, slugifyVenue } from '../src/map.ts';

/**
 * Against committed real pages. No network, no clock (CLAUDE.md rule 6).
 */
const fixture = (name: string) =>
	readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const bibliotek = parseListing(fixture('bomlobibliotek-kva-skjer.html'));
const moster = parseListing(fixture('mosteramfi-kva-skjer.html'));

const bibliotekInstance = instanceBySlug('bomlobibliotek')!;
const mosterInstance = instanceBySlug('mosteramfi')!;

describe('parseListing', () => {
	it('finds the events in the library page', () => {
		expect(bibliotek.events.length).toBeGreaterThan(0);
		expect(bibliotek.rejected).toEqual([]);
	});

	it('finds the events in the Moster Amfi page', () => {
		expect(moster.events.length).toBeGreaterThan(0);
		expect(moster.rejected).toEqual([]);
	});

	it('ignores the WebSite and Organization blocks on the same page', () => {
		// Both pages carry non-Event ld+json. Picking those up would produce nameless events.
		for (const e of [...bibliotek.events, ...moster.events]) {
			expect(e['@type']).toBe('Event');
			expect(e.name.trim()).not.toBe('');
		}
	});

	it('reads a post id for every event URL on the library page', () => {
		for (const e of bibliotek.events) {
			expect(postIdFor(bibliotek, e.url)).toMatch(/^\d+$/);
		}
	});
});

describe('mapEvent', () => {
	const mappedBibliotek = bibliotek.events.map((e) =>
		mapEvent(e, postIdFor(bibliotek, e.url), bibliotekInstance)
	);

	it('maps every library event without failures', () => {
		const failures = mappedBibliotek.filter(isFailure);
		expect(failures).toEqual([]);
	});

	it('keeps the instant the source published, offset and all', () => {
		const first = bibliotek.events[0]!;
		const mapped = mapEvent(first, postIdFor(bibliotek, first.url), bibliotekInstance);
		expect(isFailure(mapped)).toBe(false);
		if (isFailure(mapped)) return;
		expect(mapped.startsAt.toISOString()).toBe(new Date(first.startDate).toISOString());
	});

	it('gives each occurrence of a repeating event its own identity', () => {
		// The whole reason the post id is not enough: MEC repeats one post per occurrence.
		const ids = mappedBibliotek
			.filter((m) => !isFailure(m))
			.map((m) => !isFailure(m) && m.externalId);
		expect(new Set(ids).size).toBe(ids.length);

		const postIds = bibliotek.events.map((e) => postIdFor(bibliotek, e.url));
		expect(new Set(postIds).size).toBeLessThan(postIds.length);
	});

	it('falls back to the venue name when the page leaves location empty', () => {
		// Moster Amfi is single-venue and prints no location; without the fallback these events
		// would arrive with no place at all.
		for (const e of moster.events) {
			const mapped = mapEvent(e, postIdFor(moster, e.url) ?? '1', mosterInstance);
			if (isFailure(mapped)) continue;
			expect(mapped.venueName).toBe(mosterInstance.venueFallback);
		}
	});

	it('rejects an event whose URL has no post id rather than inventing one', () => {
		const e = bibliotek.events[0]!;
		const mapped = mapEvent(e, null, bibliotekInstance);
		expect(isFailure(mapped)).toBe(true);
		if (isFailure(mapped)) expect(mapped.problem).toMatch(/no data-event-id/);
	});

	it('rejects an unparseable start date', () => {
		const e = { ...bibliotek.events[0]!, startDate: 'ein gong til hausten' };
		const mapped = mapEvent(e, '123', bibliotekInstance);
		expect(isFailure(mapped)).toBe(true);
	});

	it('drops an end date that is not after the start', () => {
		const e = { ...bibliotek.events[0]!, endDate: bibliotek.events[0]!.startDate };
		const mapped = mapEvent(e, '123', bibliotekInstance);
		if (isFailure(mapped)) throw new Error('should have mapped');
		expect(mapped.endsAt).toBeNull();
	});

	it('never claims poster rights the source did not state', () => {
		for (const m of mappedBibliotek) {
			if (isFailure(m)) continue;
			expect(m.posterRightsVerified).toBe(false);
		}
	});

	it('uses a category that exists in the taxonomy', () => {
		expect(CATEGORY_SLUGS).toContain(DEFAULT_CATEGORY);
	});
});

describe('occurrenceId', () => {
	it('is stable for the same post and instant', () => {
		const d = new Date('2026-09-03T19:00:00+02:00');
		expect(occurrenceId('15252', d)).toBe(occurrenceId('15252', new Date(d)));
	});

	it('does not change when the source rewrites the same instant in another offset', () => {
		// +02:00 and the equivalent Z are the same moment; two ids would duplicate the event.
		expect(occurrenceId('15252', new Date('2026-09-03T19:00:00+02:00'))).toBe(
			occurrenceId('15252', new Date('2026-09-03T17:00:00Z'))
		);
	});
});

describe('slugifyVenue', () => {
	it('folds Norwegian letters rather than dropping them', () => {
		expect(slugifyVenue('Bømlo folkebibliotek')).toBe('boemlo-folkebibliotek');
		expect(slugifyVenue('Måløy Kafé')).toBe('maaloey-kafe');
	});
});

describe('instances', () => {
	it('has unique slugs, because the slug is the source identity', () => {
		const slugs = INSTANCES.map((i) => i.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});
});
