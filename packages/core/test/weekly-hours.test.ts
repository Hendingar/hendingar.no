import { describe, expect, it } from 'vitest';
import {
	describeWeeklyHours,
	fitsAgeBand,
	slotsOn,
	weeklyHoursSchema,
	type WeeklyHours
} from '../src/weekly-hours.ts';

describe('describeWeeklyHours', () => {
	it('puts days with the same hours on one line', () => {
		// Bømlo Symjeklubb's masters group: three mornings, one time.
		const hours: WeeklyHours = {
			cadence: 'weekly',
			slots: [
				{ weekday: 1, from: '06:00', to: '07:30' },
				{ weekday: 3, from: '06:00', to: '07:30' },
				{ weekday: 4, from: '06:00', to: '07:30' }
			]
		};
		expect(describeWeeklyHours(hours)).toEqual({
			cadence: null,
			lines: ['Måndag, onsdag og torsdag 06:00–07:30']
		});
	});

	it('never merges days whose hours differ', () => {
		// Bremnes G12, exactly as the portal lists it. Merging Saturday in would state a time that
		// is wrong on that day.
		const hours: WeeklyHours = {
			cadence: 'weekly',
			slots: [
				{ weekday: 6, from: '11:30', to: '13:00' },
				{ weekday: 2, from: '18:00', to: '19:30' },
				{ weekday: 3, from: '18:00', to: '19:30' }
			]
		};
		expect(describeWeeklyHours(hours).lines).toEqual([
			'Tysdag og onsdag 18:00–19:30',
			'Laurdag 11:30–13:00'
		]);
	});

	it('says how often when it is not every week', () => {
		// "Gudsteneste Bremnes kyrkje" is every other Sunday. A bare "Søndag 11:00" would send
		// someone to a locked church half the time.
		const text = describeWeeklyHours({
			cadence: 'even-weeks',
			slots: [{ weekday: 7, from: '11:00', to: '12:30' }]
		});
		expect(text).toEqual({ cadence: 'Partalsveker', lines: ['Sundag 11:00–12:30'] });
	});

	it('states only a start where the source gives only a start', () => {
		expect(
			describeWeeklyHours({ cadence: 'weekly', slots: [{ weekday: 5, from: '14:15', to: null }] })
				.lines
		).toEqual(['Fredag frå 14:15']);
	});
});

describe('weeklyHoursSchema', () => {
	it('refuses a timetable with no times in it', () => {
		expect(weeklyHoursSchema.safeParse({ cadence: 'weekly', slots: [] }).success).toBe(false);
	});

	it('refuses a weekday outside ISO numbering and a clock that is not HH:MM', () => {
		expect(
			weeklyHoursSchema.safeParse({
				cadence: 'weekly',
				slots: [{ weekday: 0, from: '18:00', to: null }]
			}).success
		).toBe(false);
		expect(
			weeklyHoursSchema.safeParse({
				cadence: 'weekly',
				slots: [{ weekday: 1, from: '18:00:00', to: null }]
			}).success
		).toBe(false);
	});
});

describe('slotsOn', () => {
	const sunday = (cadence: WeeklyHours['cadence']): WeeklyHours => ({
		cadence,
		slots: [{ weekday: 7, from: '11:00', to: '12:30' }]
	});

	it('meets a weekly activity on its weekday and no other', () => {
		// 2026-10-04 is a Sunday, 2026-10-05 a Monday.
		expect(slotsOn(sunday('weekly'), '2026-10-04')).toHaveLength(1);
		expect(slotsOn(sunday('weekly'), '2026-10-05')).toEqual([]);
	});

	it('reads partalsveker and oddetalsveker as ISO week numbers', () => {
		// 4 October 2026 is in week 40, 11 October in week 41.
		expect(slotsOn(sunday('even-weeks'), '2026-10-04')).toHaveLength(1);
		expect(slotsOn(sunday('even-weeks'), '2026-10-11')).toEqual([]);
		expect(slotsOn(sunday('odd-weeks'), '2026-10-11')).toHaveLength(1);
	});

	it('takes the ISO week across a new year, not the calendar year', () => {
		// 3 January 2027 is a Sunday still in week 53 of 2026 — odd, whatever January says.
		expect(slotsOn(sunday('odd-weeks'), '2027-01-03')).toHaveLength(1);
		expect(slotsOn(sunday('even-weeks'), '2027-01-03')).toEqual([]);
	});

	it('reads første and siste veka i månaden as the first and last time that weekday comes round', () => {
		expect(slotsOn(sunday('first-of-month'), '2026-10-04')).toHaveLength(1);
		expect(slotsOn(sunday('first-of-month'), '2026-10-11')).toEqual([]);
		// October 2026's Sundays: 4, 11, 18, 25. The 25th is the last.
		expect(slotsOn(sunday('last-of-month'), '2026-10-25')).toHaveLength(1);
		expect(slotsOn(sunday('last-of-month'), '2026-10-18')).toEqual([]);
	});
});

describe('fitsAgeBand', () => {
	it('matches on overlap, so an open-ended adult group is still open to a sixteen-year-old', () => {
		expect(fitsAgeBand(16, 100, 'ungdom')).toBe(true);
		expect(fitsAgeBand(16, 100, 'born')).toBe(false);
	});

	it('keeps a single-year squad to its band', () => {
		expect(fitsAgeBand(12, 12, 'born')).toBe(true);
		expect(fitsAgeBand(12, 12, 'ungdom')).toBe(false);
	});

	it('treats no range as everyone, because that is what the source means', () => {
		for (const band of ['born', 'ungdom', 'vaksne', 'seniorar'] as const) {
			expect(fitsAgeBand(null, null, band)).toBe(true);
		}
	});
});
