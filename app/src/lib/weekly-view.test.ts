import { describe, expect, it } from 'vitest';
import {
	clubsOf,
	dayLabel,
	dayView,
	nextDateFor,
	parseWeeklyParams,
	readingOrder,
	weekStrip,
	weeklyHref,
	type WeeklyActivityRow
} from './weekly-view.ts';

/**
 * Real shapes from the Bømlo portal, on fixed dates — no clock (CLAUDE.md rule 6).
 * 2026-10-03 is a laurdag in ISO week 40.
 */
const TODAY = '2026-10-03';

const row = (
	over: Partial<WeeklyActivityRow> & { id: number; title: string }
): WeeklyActivityRow => ({
	weeklyHours: null,
	ageFrom: null,
	ageTo: null,
	venueName: null,
	organizerName: null,
	...over
});

const g12 = row({
	id: 1,
	title: 'Bremnes G12',
	organizerName: 'Bremnes Idrettslag',
	venueName: 'Sentralidrettsanlegget',
	ageFrom: 12,
	ageTo: 12,
	weeklyHours: {
		cadence: 'weekly',
		slots: [
			{ weekday: 2, from: '18:00', to: '19:30' },
			{ weekday: 3, from: '18:00', to: '19:30' },
			{ weekday: 6, from: '11:30', to: '13:00' }
		]
	}
});
const g7 = row({
	id: 2,
	title: 'Bremnes G7',
	organizerName: 'Bremnes Idrettslag',
	ageFrom: 7,
	ageTo: 7,
	weeklyHours: { cadence: 'weekly', slots: [{ weekday: 3, from: '17:00', to: '18:00' }] }
});
const swim = row({
	id: 3,
	title: 'Symjing i banar',
	organizerName: 'Bømlo kommune',
	weeklyHours: {
		cadence: 'weekly',
		slots: [
			{ weekday: 6, from: '09:00', to: '12:00' },
			{ weekday: 3, from: '18:00', to: '20:00' }
		]
	}
});
const service = row({
	id: 4,
	title: 'Gudsteneste Bremnes kyrkje',
	organizerName: 'Bømlo Kyrkjelege Fellesråd',
	weeklyHours: { cadence: 'odd-weeks', slots: [{ weekday: 7, from: '11:00', to: '12:30' }] }
});
const all = [g12, g7, swim, service];

describe('the URL', () => {
	it('reads a day and an age band, and ignores words it does not know', () => {
		expect(parseWeeklyParams(new URLSearchParams('dag=laurdag&for=born'))).toEqual({
			day: 5,
			band: 'born'
		});
		expect(parseWeeklyParams(new URLSearchParams('dag=saturday&for=kids'))).toEqual({
			day: null,
			band: null
		});
	});

	it('round-trips through the hrefs the page builds', () => {
		const href = weeklyHref(1, 'ungdom');
		expect(href).toBe('/alltid-ope?dag=tysdag&for=ungdom#dag');
		const params = new URL(href, 'https://hendingar.no').searchParams;
		expect(parseWeeklyParams(params)).toEqual({ day: 1, band: 'ungdom' });
		expect(weeklyHref(null, null)).toBe('/alltid-ope#dag');
	});
});

describe('the week strip', () => {
	it('gives every weekday its next date, today included', () => {
		expect(nextDateFor(TODAY, 5)).toBe('2026-10-03');
		expect(nextDateFor(TODAY, 6)).toBe('2026-10-04');
		expect(nextDateFor(TODAY, 0)).toBe('2026-10-05');
		expect(nextDateFor(TODAY, 4)).toBe('2026-10-09');
	});

	it('counts what meets each day, and marks today', () => {
		const strip = weekStrip(all, TODAY, null);
		expect(strip.map((d) => d.short)).toEqual(['Må', 'Ty', 'On', 'To', 'Fr', 'La', 'Su']);
		const byShort = Object.fromEntries(strip.map((d) => [d.short, d.count]));
		expect(byShort).toMatchObject({ Ty: 1, On: 3, La: 2 });
		expect(strip.filter((d) => d.isToday).map((d) => d.short)).toEqual(['La']);
	});

	it('leaves a fortnightly service off the Sunday it does not meet', () => {
		// The next Sunday is 4 October, week 40 — even. This service is odd weeks.
		expect(weekStrip(all, TODAY, null).find((d) => d.short === 'Su')?.count).toBe(0);
		// A week later it is on.
		expect(weekStrip(all, '2026-10-10', null).find((d) => d.short === 'Su')?.count).toBe(1);
	});

	it('narrows every count to the chosen age band', () => {
		const born = Object.fromEntries(weekStrip(all, TODAY, 'born').map((d) => [d.short, d.count]));
		// G12 and G7 are children's squads; the swimming states no age, so it is for everyone.
		expect(born).toMatchObject({ On: 3, La: 2 });
		const vaksne = Object.fromEntries(
			weekStrip(all, TODAY, 'vaksne').map((d) => [d.short, d.count])
		);
		expect(vaksne).toMatchObject({ On: 1, La: 1 });
	});
});

describe('a day', () => {
	it('lists what meets by time, split into parts of the day', () => {
		const { periods, count } = dayView(all, '2026-10-07', null);
		expect(count).toBe(3);
		expect(periods.map((p) => p.name)).toEqual(['Kveld']);
		expect(periods[0]!.rows.map((r) => `${r.from} ${r.title}`)).toEqual([
			'17:00 Bremnes G7',
			'18:00 Bremnes G12',
			'18:00 Symjing i banar'
		]);
	});

	it('leaves empty parts of the day out rather than showing them bare', () => {
		const { periods } = dayView(all, TODAY, null);
		expect(periods.map((p) => [p.name, p.rows.length])).toEqual([['Føremiddag', 2]]);
	});

	it('names the date the way a reader says it', () => {
		expect(dayLabel(TODAY)).toBe('laurdag 3. oktober');
	});
});

describe('the clubs', () => {
	it('puts the biggest first, with the days it meets', () => {
		const clubs = clubsOf(all);
		expect(clubs[0]!.name).toBe('Bremnes Idrettslag');
		// Tysdag, onsdag and laurdag, from two squads.
		expect(clubs[0]!.meets).toEqual([false, true, true, false, false, true, false]);
		// "G7" before "G12": squads sort by age, not by character.
		expect(clubs[0]!.activities.map((a) => a.title)).toEqual(['Bremnes G7', 'Bremnes G12']);
	});
});

describe('readingOrder', () => {
	it('sorts numbers by value and the Norwegian letters after z', () => {
		const titles = ['Bremnes G12', 'Bremnes G7', 'Ørland', 'Zumba', 'Åsen', 'Bremnes G9'];
		expect(titles.sort(readingOrder)).toEqual([
			'Bremnes G7',
			'Bremnes G9',
			'Bremnes G12',
			'Zumba',
			'Ørland',
			'Åsen'
		]);
	});
});
