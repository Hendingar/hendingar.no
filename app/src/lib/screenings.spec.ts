import { describe, expect, it } from 'vitest';
import { screeningDays, showsInSeveralRooms, type Screening } from './screenings.ts';

/** Stord kino's real week for Sense and Sensibility: two rooms, three days. */
const screening = (id: number, iso: string, localDate: string, room: string): Screening => ({
	id,
	startsAt: new Date(iso),
	ctaUrl: null,
	venueName: room,
	venueTimeZone: 'Europe/Oslo',
	localDate
});

const week = [
	screening(3, '2026-10-15T17:15:00Z', '2026-10-15', 'Småsalen'),
	screening(1, '2026-10-13T17:30:00Z', '2026-10-13', 'Storsalen'),
	screening(4, '2026-10-15T19:30:00Z', '2026-10-15', 'Småsalen'),
	screening(2, '2026-10-14T11:00:00Z', '2026-10-14', 'Småsalen')
];

describe('screeningDays', () => {
	it('puts every screening under its day, in order, whatever order they arrive in', () => {
		expect(screeningDays(week).map((d) => [d.localDate, d.screenings.map((s) => s.id)])).toEqual([
			['2026-10-13', [1]],
			['2026-10-14', [2]],
			['2026-10-15', [3, 4]]
		]);
	});

	it('trusts the venue-local day it is given rather than the UTC date of the instant', () => {
		// 23:30 UTC on the 14th is 01:30 on the 15th in Oslo: a late show belongs to the 15th.
		const late = screening(9, '2026-10-14T23:30:00Z', '2026-10-15', 'Storsalen');
		expect(screeningDays([late])[0]?.localDate).toBe('2026-10-15');
	});

	it('is empty for no screenings', () => {
		expect(screeningDays([])).toEqual([]);
	});
});

describe('showsInSeveralRooms', () => {
	it('names the room only when the film plays in more than one', () => {
		expect(showsInSeveralRooms(week)).toBe(true);
		expect(showsInSeveralRooms(week.filter((s) => s.venueName === 'Småsalen'))).toBe(false);
	});
});
