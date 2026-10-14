import { describe, expect, it } from 'vitest';
import type { PublicEventDetail } from '@hendingar/core/public-event';
import { groupByDay, placeOf, timeOf } from './days.ts';

function event(overrides: Partial<PublicEventDetail>): PublicEventDetail {
	return {
		id: 1,
		title: 'Konsert',
		category: 'musikk',
		categoryLabel: 'Musikk',
		startsAt: '2026-10-17T20:00:00+02:00',
		endsAt: null,
		when: 'lør. 17. okt. 2026, 20:00',
		timeZone: 'Europe/Oslo',
		venue: 'Stord kulturhus',
		municipality: 'Stord',
		url: 'https://hendingar.no/hending/1-konsert',
		icsUrl: 'https://hendingar.no/hending/1-konsert/kalender.ics',
		posterUrl: null,
		sources: [],
		description: null,
		organizer: null,
		address: null,
		postalCode: null,
		latitude: null,
		longitude: null,
		ticketUrl: null,
		sourceUrl: null,
		submittedByReader: false,
		weeklyHours: null,
		ageFrom: null,
		ageTo: null,
		duplicateOf: null,
		removedUpstream: false,
		...overrides
	};
}

const TODAY = '2026-10-16';

describe('groupByDay', () => {
	it('groups by the venue day, soonest first, whatever order the assistant gave', () => {
		const days = groupByDay(
			[
				event({ id: 2, startsAt: '2026-10-18T11:00:00+02:00' }),
				event({ id: 1, startsAt: '2026-10-17T20:00:00+02:00' }),
				event({ id: 3, startsAt: '2026-10-17T18:00:00+02:00' })
			],
			TODAY
		);
		expect(days.map((d) => d.date)).toEqual(['2026-10-17', '2026-10-18']);
		expect(days[0]?.label).toBe('I morgon');
		expect(days[0]?.events.map((e) => e.id)).toEqual([3, 1]);
		expect(days[1]?.label).toBe('Sundag 18. oktober');
	});

	it('reads the day off the venue offset, not the reader’s clock', () => {
		// 00:30 in Oslo is still the evening before in UTC. The card belongs to the Oslo day.
		const days = groupByDay([event({ startsAt: '2026-10-17T00:30:00+02:00' })], TODAY);
		expect(days[0]?.date).toBe('2026-10-17');
	});

	it('puts something already running under today', () => {
		const days = groupByDay(
			[event({ startsAt: '2026-10-12T10:00:00+02:00', endsAt: '2026-10-23T18:00:00+02:00' })],
			TODAY
		);
		expect(days[0]?.label).toBe('I dag');
	});
});

describe('timeOf', () => {
	it('gives the clock, and the end when it ends the same day', () => {
		expect(timeOf(event({}))).toBe('20:00');
		expect(timeOf(event({ endsAt: '2026-10-17T22:30:00+02:00' }))).toBe('20:00–22:30');
	});

	it('says how long something that spans days runs', () => {
		expect(timeOf(event({ endsAt: '2026-10-23T18:00:00+02:00' }))).toBe('til 23. oktober');
	});

	it('leaves a weekly activity to its timetable', () => {
		expect(timeOf(event({ weeklyHours: { cadence: null, lines: ['Tysdag 18:00–19:30'] } }))).toBe(
			null
		);
	});
});

describe('placeOf', () => {
	it('names the municipality once', () => {
		expect(placeOf(event({ venue: 'Storsalen', municipality: 'Bømlo' }))).toBe('Storsalen, Bømlo');
		expect(placeOf(event({ venue: 'Stord kulturhus', municipality: 'Stord' }))).toBe(
			'Stord kulturhus'
		);
		expect(placeOf(event({ venue: null, municipality: 'Fitjar' }))).toBe('Fitjar');
	});
});
