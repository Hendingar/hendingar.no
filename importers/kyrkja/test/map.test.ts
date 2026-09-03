import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { INSTANCES, extractCalendarHtml, instanceBySlug, parseCalendar } from '../src/api.ts';
import { DEFAULT_CATEGORY, isFailure, mapCategory, mapEvent, slugifyVenue } from '../src/map.ts';

/**
 * Against the committed real page. No network (CLAUDE.md rule 6).
 */
const page = readFileSync(
	fileURLToPath(new URL('./fixtures/bomlo-kalender.html', import.meta.url)),
	'utf8'
);
const instance = instanceBySlug('bomlo-kyrkja')!;
const calendarHtml = extractCalendarHtml(page)!;
const parsed = parseCalendar(calendarHtml, instance.url);

describe('extractCalendarHtml', () => {
	it('finds the calendar inside the escaped script blob', () => {
		// The page's own markup has no dates at all — the calendar is JSON-escaped in a script tag
		// and injected by JavaScript. Searching the HTML for date-shaped text finds nothing, which
		// is the trap this importer exists to get past.
		expect(calendarHtml).toBeTruthy();
		expect(calendarHtml).toContain('calendar-item');
		expect(page).not.toContain('<div class="calendar-item">');
	});

	it('returns null when the blob is absent, so a redesign fails loudly', () => {
		expect(extractCalendarHtml('<html><body>no calendar here</body></html>')).toBeNull();
		expect(extractCalendarHtml('var data = {"d":not-json};')).toBeNull();
	});
});

describe('parseCalendar', () => {
	it('reads every event on the page', () => {
		expect(parsed.events.length).toBeGreaterThan(50);
		expect(parsed.rejected).toEqual([]);
	});

	it('gives every event a stable occurrence id, and they are unique', () => {
		const ids = parsed.events.map((e) => e.occurrenceId);
		expect(ids.every((id) => /^[0-9a-f-]{8,}$/.test(id))).toBe(true);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('takes the year from the page, not the clock', () => {
		/*
		 * This is the whole reason the year headings are parsed. Dates print as `dd.mm` with no
		 * year, and the calendar runs September through the following May — so reading the year
		 * from `new Date()` would file every spring event twelve months early. The fixture spans
		 * two years and the later months must land in the later one.
		 */
		const years = [...new Set(parsed.events.map((e) => e.localDate.slice(0, 4)))].sort();
		expect(years.length).toBeGreaterThan(1);

		const december = parsed.events.find((e) => e.localDate.slice(5, 7) === '12');
		const may = parsed.events.find((e) => e.localDate.slice(5, 7) === '05');
		expect(december, 'the fixture should contain a December event').toBeTruthy();
		expect(may, 'the fixture should contain a May event').toBeTruthy();
		expect(Number(may!.localDate.slice(0, 4))).toBeGreaterThan(
			Number(december!.localDate.slice(0, 4))
		);
	});

	it('reads a time for every event', () => {
		for (const e of parsed.events) expect(e.localTime).toMatch(/^\d{2}:\d{2}$/);
	});

	it('reads the church rather than the parish for most events', () => {
		const churches = new Set(parsed.events.map((e) => e.location).filter(Boolean));
		// Bremnes, Moster, Bømlo, Lykling… a parish calendar covers several buildings, and putting
		// them all at one address would make the map useless later.
		expect(churches.size).toBeGreaterThan(1);
	});

	it('makes every link absolute', () => {
		for (const e of parsed.events) expect(e.href).toMatch(/^https:\/\/bomlo\.kyrkja\.no\//);
	});

	it('reports an item it cannot read instead of dropping it silently', () => {
		const broken = `<div class="year">2026</div><div class="calendar-item"><div class="calendar-data"><div class="calendar-day">Søndag</div></div></div>`;
		const out = parseCalendar(broken, instance.url);
		expect(out.events).toEqual([]);
		expect(out.rejected.length).toBe(1);
	});

	it('rejects an event whose link has no OccurenceId rather than inventing an identity', () => {
		const noId = `<div class="year">2026</div><div class="calendar-item"><div class="calendar-date">06.09</div><div class="event"><div class="event-time">kl.11.00</div><p class="info-text"><a href="CalendarPage?Publish=All" >Gudstjeneste</a></p></div></div>`;
		const out = parseCalendar(noId, instance.url);
		expect(out.events).toEqual([]);
		expect(out.rejected.join(' ')).toMatch(/OccurenceId/);
	});
});

describe('mapEvent', () => {
	const mapped = parsed.events.map((e) => mapEvent(e, instance));

	it('maps every event without failures', () => {
		expect(mapped.filter(isFailure)).toEqual([]);
	});

	it('resolves the wall clock in the church zone, not the server one', () => {
		// 11:00 in Oslo during summer time is 09:00Z. Building a Date from the page's text would
		// give whatever the server's zone happens to be — wrong everywhere but Norway, and wrong
		// twice a year there.
		const summer = parsed.events.find(
			(e) => e.localDate === '2026-09-06' && e.localTime === '11:00'
		);
		expect(summer, 'fixture should have the 6 September 11:00 service').toBeTruthy();
		const m = mapEvent(summer!, instance);
		if (isFailure(m)) throw new Error('should have mapped');
		expect(m.startsAt.toISOString()).toBe('2026-09-06T09:00:00.000Z');
	});

	it('resolves a winter time an hour differently, which is the DST case', () => {
		const winter = { ...parsed.events[0]!, localDate: '2026-12-24', localTime: '16:00' };
		const m = mapEvent(winter, instance);
		if (isFailure(m)) throw new Error('should have mapped');
		// CET, not CEST: 15:00Z. A single-pass offset lookup gets this wrong near the boundary.
		expect(m.startsAt.toISOString()).toBe('2026-12-24T15:00:00.000Z');
	});

	it('leaves the end time null rather than inventing a duration', () => {
		for (const m of mapped) {
			if (isFailure(m)) continue;
			expect(m.endsAt).toBeNull();
		}
	});

	it('claims no poster rights, because there are no posters', () => {
		for (const m of mapped) {
			if (isFailure(m)) continue;
			expect(m.posterUrl).toBeNull();
			expect(m.posterRightsVerified).toBe(false);
		}
	});
});

describe('mapCategory', () => {
	it('defaults to church life, because that is a fact about the source', () => {
		expect(mapCategory('')).toBe('kyrkjeliv');
		expect(mapCategory('Trusopplæring')).toBe('kyrkjeliv');
		expect(DEFAULT_CATEGORY).toBe('kyrkjeliv');
	});

	it('honours a label our taxonomy has a word for', () => {
		expect(mapCategory('Konsert')).toBe('musikk');
		expect(mapCategory('kor')).toBe('musikk');
	});

	it('only ever returns a slug that exists in the taxonomy', () => {
		for (const label of ['', 'Konsert', 'Trusopplæring', 'noko heilt anna']) {
			expect(CATEGORY_SLUGS).toContain(mapCategory(label));
		}
	});
});

describe('slugifyVenue', () => {
	it('folds Norwegian letters rather than dropping them', () => {
		expect(slugifyVenue('Bømlo kyrkje')).toBe('boemlo-kyrkje');
		expect(slugifyVenue('Bremnes kyrkje')).toBe('bremnes-kyrkje');
	});
});

describe('instances', () => {
	it('has unique slugs, and keeps the one the directory already used', () => {
		const slugs = INSTANCES.map((i) => i.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		// The directory lists this same slug as a linked source; diverging would create a second row.
		expect(instanceBySlug('bomlo-kyrkja')).toBeTruthy();
	});
});
