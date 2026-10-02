import { describe, expect, it } from 'vitest';
import { describeWeeklyHours, weeklyHoursSchema, type WeeklyHours } from '../src/weekly-hours.ts';

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
