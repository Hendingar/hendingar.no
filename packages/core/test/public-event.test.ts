import { describe, expect, it } from 'vitest';
import {
	publicEventDetailSchema,
	publicEventSchema,
	toPublicEvent,
	toPublicEventDetail,
	viewResultSchema,
	type DetailRowInput,
	type ListingRowInput
} from '../src/public-event.ts';

const ORIGIN = 'https://hendingar.no';

const row: ListingRowInput = {
	id: 133,
	title: 'Pokémontreff i biblioteket',
	category: 'kurs',
	startsAt: new Date('2026-09-07T14:00:00Z'),
	endsAt: new Date('2026-09-07T16:00:00Z'),
	venueName: 'Bømlo folkebibliotek',
	venueTimeZone: 'Europe/Oslo',
	municipality: 'Bømlo',
	posterUrl: null,
	sourceMarks: [{ slug: 'mec-bomlo-bibliotek', name: 'Bømlo folkebibliotek' }]
};

const detail: DetailRowInput = {
	...row,
	description: '<p>Ta med &amp; byt kort.</p>',
	ctaUrl: null,
	sourceUrl: 'https://bibliotek.example/pokemon',
	submissionMethod: 'import',
	venueAddress: 'Rubbestadneset',
	venuePostalCode: '5437',
	venueMunicipality: 'Bømlo',
	venueLatitude: 59.77,
	venueLongitude: 5.22,
	organizerName: null,
	weeklyHours: null,
	ageFrom: 8,
	ageTo: null,
	duplicateOfId: null,
	duplicateOfTitle: null,
	removedUpstreamAt: null,
	reportedBy: [
		{
			slug: 'mec-bomlo-bibliotek',
			name: 'Bømlo folkebibliotek',
			siteUrl: 'https://bibliotek.example',
			eventUrl: 'https://bibliotek.example/pokemon'
		}
	]
};

describe('toPublicEvent', () => {
	it('links the event on hendingar.no, its calendar file, and its source', () => {
		const event = toPublicEvent(row, ORIGIN);
		expect(event.url).toBe('https://hendingar.no/hending/133-pokemontreff-i-biblioteket');
		expect(event.icsUrl).toBe(`${event.url}/kalender.ics`);
		expect(event.sources).toEqual([{ slug: 'mec-bomlo-bibliotek', name: 'Bømlo folkebibliotek' }]);
		expect(publicEventSchema.parse(event)).toEqual(event);
	});

	it("writes the venue's own offset and wall clock, not UTC", () => {
		const event = toPublicEvent(row, ORIGIN);
		expect(event.startsAt).toBe('2026-09-07T16:00:00+02:00');
		expect(event.when).toContain('16:00');
	});

	it('renders a Helsinki venue at Helsinki time, not Oslo time', () => {
		const event = toPublicEvent(
			{ ...row, venueTimeZone: 'Europe/Helsinki', startsAt: new Date('2026-09-12T17:00:00Z') },
			ORIGIN
		);
		expect(event.startsAt).toBe('2026-09-12T20:00:00+03:00');
		expect(event.when).toContain('20:00');
		expect(event.timeZone).toBe('Europe/Helsinki');
	});

	it('falls back to Oslo for a venue with no zone, and says so', () => {
		const event = toPublicEvent({ ...row, venueTimeZone: null }, ORIGIN);
		expect(event.timeZone).toBe('Europe/Oslo');
	});

	it('makes a same-origin poster absolute, and leaves a hot-linked one alone', () => {
		expect(toPublicEvent({ ...row, posterUrl: '/seed-poster.svg' }, ORIGIN).posterUrl).toBe(
			'https://hendingar.no/seed-poster.svg'
		);
		expect(
			toPublicEvent({ ...row, posterUrl: 'https://cdn.example/p.jpg' }, ORIGIN).posterUrl
		).toBe('https://cdn.example/p.jpg');
	});

	it('names a row with no sources as having none, rather than inventing one', () => {
		expect(toPublicEvent({ ...row, sourceMarks: null }, ORIGIN).sources).toEqual([]);
	});

	it('links the origin it is given, so a local server does not hand out production links', () => {
		expect(toPublicEvent(row, 'http://localhost:5173').url).toMatch(/^http:\/\/localhost:5173\//);
	});
});

describe('toPublicEventDetail', () => {
	it('carries each source with its own link to the event', () => {
		const event = toPublicEventDetail(detail, ORIGIN);
		expect(event.sources[0]?.eventUrl).toBe('https://bibliotek.example/pokemon');
		expect(publicEventDetailSchema.parse(event)).toEqual(event);
	});

	it('hands over the description as text, not markup', () => {
		expect(toPublicEventDetail(detail, ORIGIN).description).toBe('Ta med & byt kort.');
	});

	it('says when a reader sent it in', () => {
		expect(toPublicEventDetail(detail, ORIGIN).submittedByReader).toBe(false);
		expect(
			toPublicEventDetail({ ...detail, submissionMethod: 'form', reportedBy: [] }, ORIGIN)
				.submittedByReader
		).toBe(true);
	});

	it('points a duplicate at the event it duplicates', () => {
		const event = toPublicEventDetail(
			{ ...detail, duplicateOfId: 90, duplicateOfTitle: 'Pokémon' },
			ORIGIN
		);
		expect(event.duplicateOf).toEqual({ id: 90, url: 'https://hendingar.no/hending/90-pokemon' });
	});

	it('spells out a timetable instead of a start time it does not really have', () => {
		const event = toPublicEventDetail(
			{
				...detail,
				weeklyHours: { cadence: 'weekly', slots: [{ weekday: 1, from: '18:00', to: '19:30' }] }
			},
			ORIGIN
		);
		expect(event.weeklyHours?.lines).toHaveLength(1);
		expect(event.weeklyHours?.lines[0]).toContain('18:00');
	});

	it('has no field for hearts, views or rank', () => {
		const keys = Object.keys(publicEventDetailSchema.shape);
		for (const banned of ['hearts', 'views', 'rank', 'popularity']) {
			expect(keys).not.toContain(banned);
		}
	});
});

describe('viewResultSchema', () => {
	it('takes a list tool result as it is, and a show_events result too', () => {
		const listed = {
			today: '2026-10-16',
			timeZone: 'Europe/Oslo',
			count: 1,
			events: [toPublicEvent(row, ORIGIN)]
		};
		expect(viewResultSchema.parse(listed).events[0]?.ticketUrl).toBeUndefined();
		const shown = {
			heading: 'Fredag',
			today: '2026-10-16',
			timeZone: 'Europe/Oslo',
			events: [toPublicEventDetail(detail, ORIGIN)],
			missing: []
		};
		expect(viewResultSchema.parse(shown).events[0]?.description).toBe('Ta med & byt kort.');
	});
});
