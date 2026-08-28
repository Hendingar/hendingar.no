import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { collectPages, upstreamPageSchema, type FetchPage } from '../src/api.ts';
import { MAPPED_SLUGS, isFailure, mapCategory, mapEvent, slugifyVenue } from '../src/map.ts';

/** Committed fixtures, captured from the live API. No test here touches the network. */
function fixture(page: number): unknown {
	return JSON.parse(
		readFileSync(
			fileURLToPath(new URL(`./fixtures/events-page${page}.json`, import.meta.url)),
			'utf-8'
		)
	);
}

const readFixtures: FetchPage = async (page) =>
	page <= 2 ? fixture(page) : { events: [], next_page: null };

/** A parsed fixture page, so tests index into typed data rather than `unknown`. */
function parsed(page: number) {
	return upstreamPageSchema.parse(fixture(page));
}

/** First event of a page, asserted present — the fixtures are committed and non-empty. */
function firstEvent(page = 1) {
	const [event] = parsed(page).events;
	if (!event) throw new Error(`fixture page ${page} has no events`);
	return event;
}

describe('upstream schema', () => {
	it('accepts the real payload', () => {
		for (const page of [1, 2]) {
			expect(upstreamPageSchema.safeParse(fixture(page)).success, `page ${page}`).toBe(true);
		}
	});

	it('rejects a payload that lost a field we depend on', () => {
		const broken = structuredClone(fixture(1)) as { events: Record<string, unknown>[] };
		const [first] = broken.events;
		expect(first).toBeDefined();
		delete first?.eventTime;
		expect(upstreamPageSchema.safeParse(broken).success).toBe(false);
	});

	it('tolerates new upstream fields', () => {
		const extended = structuredClone(fixture(1)) as { events: Record<string, unknown>[] };
		const [first] = extended.events;
		expect(first).toBeDefined();
		if (first) first.somethingInnocodeAddedLater = true;
		expect(upstreamPageSchema.safeParse(extended).success).toBe(true);
	});
});

describe('pagination', () => {
	it('follows next_page and stops on an empty window', async () => {
		const { pages, rejected } = await collectPages(readFixtures);
		expect(rejected).toEqual([]);
		expect(pages.length).toBe(3); // two fixture weeks, then the empty stop
		expect(pages[0]?.events.length).toBeGreaterThan(0);
	});

	it('does not use `total` for loop control', async () => {
		// total is the overall upcoming count (126), not a page count. If it were ever used as a
		// bound this would spin far past the fixtures.
		const { pages } = await collectPages(readFixtures);
		const totals = pages.map((p) => p.total).filter(Boolean);
		expect(totals[0]).toBeGreaterThan(pages.length);
	});

	it('honours the horizon cap even if the source never stops', async () => {
		let calls = 0;
		const sample = firstEvent();
		const endless: FetchPage = async (page) => {
			calls += 1;
			return { events: [{ ...sample }], next_page: page + 1 };
		};
		await collectPages(endless, 5);
		expect(calls).toBe(5);
	});
});

describe('category mapping', () => {
	it('maps every id we have seen to a slug in the taxonomy', () => {
		for (const slug of MAPPED_SLUGS) {
			expect(CATEGORY_SLUGS).toContain(slug);
		}
	});

	it('maps by id first, then name, then falls back', () => {
		expect(mapCategory(642, 'anything')).toBe('musikk');
		expect(mapCategory(null, 'Kyrkjeliv')).toBe('kyrkjeliv');
		expect(mapCategory(999999, 'a category invented next week')).toBe('anna');
		expect(mapCategory(null, null)).toBe('anna');
	});

	it('maps the whole fixture set without falling back for known categories', () => {
		const page = parsed(1);
		const unknown = page.events.filter(
			(e) =>
				e.categoryId != null &&
				mapCategory(e.categoryId, e.categoryName) === 'anna' &&
				e.categoryName?.toLowerCase() !== 'andre'
		);
		expect(unknown).toEqual([]);
	});
});

describe('event mapping', () => {
	const page = parsed(1);

	it('maps the fixture page deterministically', () => {
		const once = page.events.map(mapEvent);
		const twice = page.events.map(mapEvent);
		expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
	});

	it('produces a usable event for every approved fixture record', () => {
		const approved = page.events.filter((e) => e.status === 'approved');
		expect(approved.length).toBeGreaterThan(0);
		for (const raw of approved) {
			const mapped = mapEvent(raw);
			expect(isFailure(mapped), `${raw.id} ${raw.title}`).toBe(false);
			if (!isFailure(mapped)) {
				expect(mapped.title.length).toBeGreaterThan(0);
				expect(Number.isNaN(mapped.startsAt.getTime())).toBe(false);
				expect(mapped.sourceUrl).toMatch(/^https:\/\/detskjer\.sunnhordland\.no\/events\//);
			}
		}
	});

	it('preserves the instant, not a reinterpreted wall clock', () => {
		const raw = { ...firstEvent(), eventTime: '2026-09-12T20:00:00.000+02:00' };
		const mapped = mapEvent(raw);
		expect(isFailure(mapped)).toBe(false);
		if (!isFailure(mapped)) expect(mapped.startsAt.toISOString()).toBe('2026-09-12T18:00:00.000Z');
	});

	it('carries the poster URL and records the rights flag separately', () => {
		const raw = {
			...firstEvent(),
			imageRightsVerified: false,
			posterUrls: ['https://example.com/poster.jpg']
		};
		const mapped = mapEvent(raw);
		if (!isFailure(mapped)) {
			// Hotlinked, never copied onto our infrastructure.
			expect(mapped.posterUrl).toBe('https://example.com/poster.jpg');
			// The flag is preserved so a future policy can act on it.
			expect(mapped.posterRightsVerified).toBe(false);
		}

		const ok = mapEvent({ ...raw, imageRightsVerified: true });
		if (!isFailure(ok)) expect(ok.posterRightsVerified).toBe(true);
	});

	it('still refuses a poster that is not an http url', () => {
		const mapped = mapEvent({ ...firstEvent(), posterUrls: ['javascript:alert(1)'] });
		if (!isFailure(mapped)) expect(mapped.posterUrl).toBeNull();
	});

	it('drops records the source has not approved', () => {
		const mapped = mapEvent({ ...firstEvent(), status: 'pending' });
		expect(isFailure(mapped)).toBe(true);
	});

	it('rejects an unparseable start, and ignores an impossible end', () => {
		expect(isFailure(mapEvent({ ...firstEvent(), eventTime: 'not a date' }))).toBe(true);

		const backwards = mapEvent({
			...firstEvent(),
			eventTime: '2026-09-12T20:00:00.000+02:00',
			eventEndTime: '2026-09-12T19:00:00.000+02:00'
		});
		if (!isFailure(backwards)) expect(backwards.endsAt).toBeNull();
	});

	it('does not treat a repeated title as a venue', () => {
		const mapped = mapEvent({
			...firstEvent(),
			title: 'Busstur til Bergen Blomstersjov',
			location: 'Busstur til Bergen Blomstersjov'
		});
		if (!isFailure(mapped)) {
			expect(mapped.venueName).toBeNull();
			expect(mapped.venueSlug).toBeNull();
		}
	});

	it('keeps a genuine venue', () => {
		const mapped = mapEvent({
			...firstEvent(),
			title: 'Frøken Julie',
			location: 'Baroniet Rosendal'
		});
		if (!isFailure(mapped)) expect(mapped.venueName).toBe('Baroniet Rosendal');
	});

	it('refuses a non-http cta url', () => {
		const mapped = mapEvent({ ...firstEvent(), ctaUrl: 'javascript:alert(1)' });
		if (!isFailure(mapped)) expect(mapped.ctaUrl).toBeNull();
	});
});

describe('venue slugs', () => {
	it('transliterates Norwegian characters rather than dropping them', () => {
		expect(slugifyVenue('Den Blå Time')).toBe('den-blaa-time');
		expect(slugifyVenue('Kulturhuset Æ Ø Å')).toBe('kulturhuset-ae-oe-aa');
	});

	it('is stable and collision-free across the fixture venues', () => {
		const page1 = parsed(1);
		const byName = new Map<string, string>();
		for (const e of page1.events) {
			const name = e.location?.trim();
			if (!name) continue;
			const slug = slugifyVenue(name);
			expect(slug.length).toBeGreaterThan(0);
			const seen = byName.get(slug);
			// The same slug must only ever come from the same name.
			if (seen) expect(seen).toBe(name);
			byName.set(slug, name);
		}
	});
});
