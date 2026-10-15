import { describe, expect, it } from 'vitest';
import { sameEvent, type EventValues } from '../src/ingest-run.ts';

/**
 * The comparison that decides `unchanged` versus `updated` — the number /datasamling shows. The
 * database half of the run is exercised by `pnpm ingest`; this is the part a wrong answer from
 * would mark every row updated every night, or none of them ever.
 */
const row = {
	title: 'Bok og strikk',
	description: null,
	category: 'litteratur' as const,
	startsAt: new Date('2026-09-07T14:00:00Z'),
	endsAt: null,
	venueId: 4,
	organizerId: null,
	ctaUrl: null,
	posterUrl: null,
	posterSrcset: null,
	posterRightsVerified: false,
	status: 'published' as const,
	sourceUrl: 'https://example.no/bok-og-strikk',
	weeklyHours: null,
	trail: null,
	ageFrom: null,
	ageTo: null
};

const sent: EventValues = {
	sourceId: 1,
	externalId: '7@2026-09-07',
	title: 'Bok og strikk',
	category: 'litteratur',
	startsAt: new Date('2026-09-07T14:00:00Z'),
	venueId: 4,
	sourceUrl: 'https://example.no/bok-og-strikk'
};

describe('sameEvent', () => {
	it('compares instants by value, not by identity', () => {
		expect(sameEvent(row, { ...sent, startsAt: new Date(row.startsAt.getTime()) })).toBe(true);
		expect(sameEvent(row, { ...sent, startsAt: new Date('2026-09-07T16:00:00Z') })).toBe(false);
	});

	it('ignores a column the importer does not send', () => {
		expect(sameEvent({ ...row, posterUrl: 'https://example.no/p.jpg' }, sent)).toBe(true);
	});

	it('treats a sent null as a value, so clearing a column is a change', () => {
		expect(
			sameEvent({ ...row, ctaUrl: 'https://example.no/billett' }, { ...sent, ctaUrl: null })
		).toBe(false);
		expect(sameEvent(row, { ...sent, endsAt: null })).toBe(true);
	});

	it('compares opening hours by meaning, not by object identity', () => {
		const hours = {
			cadence: 'weekly' as const,
			slots: [{ weekday: 2 as const, from: '18:00', to: null }]
		};
		expect(
			sameEvent({ ...row, weeklyHours: hours }, { ...sent, weeklyHours: structuredClone(hours) })
		).toBe(true);
	});
});
