import { describe, expect, it } from 'vitest';
import { stackOccurrences } from './occurrences.ts';
import type { UpcomingEvent } from './events.remote';

/**
 * The rule that stops four identical swimming posters filling a screen.
 */
const ev = (id: number, title: string, hour: number, venue: string | null = 'Symjehallen') =>
	({
		id,
		title,
		venueName: venue,
		startsAt: new Date(`2026-09-03T${String(hour).padStart(2, '0')}:00:00Z`),
		venueTimeZone: 'Europe/Oslo',
		category: 'sport',
		endsAt: null,
		municipality: null,
		posterUrl: null,
		sourceName: 'Stord kulturhus',
		sourceIconUrl: null,
		localDate: '2026-09-03',
		todayLocalDate: '2026-09-03'
	}) as unknown as UpcomingEvent;

describe('stackOccurrences', () => {
	it('collapses repeats of the same event into one card', () => {
		const stacks = stackOccurrences([
			ev(1, 'Offentleg symjing', 12),
			ev(2, 'Offentleg symjing', 17),
			ev(3, 'Offentleg symjing', 18)
		]);
		expect(stacks).toHaveLength(1);
		expect(stacks[0]!.occurrences.map((o) => o.id)).toEqual([1, 2, 3]);
	});

	it('keeps every occurrence addressable, because each is a real event', () => {
		// The card is a display grouping; the rows are not merged and each keeps its own page.
		const stacks = stackOccurrences([ev(1, 'Språkkafé', 15), ev(2, 'Språkkafé', 17)]);
		expect(stacks[0]!.occurrences).toHaveLength(2);
		expect(new Set(stacks[0]!.occurrences.map((o) => o.id)).size).toBe(2);
	});

	it('always populates occurrences, even for a single showing', () => {
		const stacks = stackOccurrences([ev(1, 'Konsert', 19)]);
		expect(stacks[0]!.occurrences).toHaveLength(1);
		expect(stacks[0]!.occurrences[0]!.id).toBe(1);
	});

	it('does not stack the same title at different venues', () => {
		// Two churches both hold "Gudstjeneste" — one card would claim they are one thing.
		const stacks = stackOccurrences([
			ev(1, 'Gudstjeneste', 11, 'Bremnes kyrkje'),
			ev(2, 'Gudstjeneste', 11, 'Moster kyrkje')
		]);
		expect(stacks).toHaveLength(2);
	});

	it('ignores case and spacing, which is how the same title arrives twice', () => {
		const stacks = stackOccurrences([
			ev(1, 'Offentleg symjing', 12),
			ev(2, '  offentleg   symjing ', 17)
		]);
		expect(stacks).toHaveLength(1);
	});

	it('keeps the day chronological: a stack sits where its first occurrence was', () => {
		const stacks = stackOccurrences([
			ev(1, 'Morgontrening', 8),
			ev(2, 'Offentleg symjing', 12),
			ev(3, 'Konsert', 19),
			ev(4, 'Offentleg symjing', 20)
		]);
		expect(stacks.map((s) => s.lead.title)).toEqual([
			'Morgontrening',
			'Offentleg symjing',
			'Konsert'
		]);
		// …and the late swim joins the earlier card rather than starting a new one at the end.
		expect(stacks[1]!.occurrences.map((o) => o.id)).toEqual([2, 4]);
	});

	it('orders the times within a card even when the input is not sorted', () => {
		const stacks = stackOccurrences([ev(1, 'Symjing', 18), ev(2, 'Symjing', 12)]);
		expect(stacks[0]!.occurrences.map((o) => o.id)).toEqual([2, 1]);
	});

	it('treats a missing venue as its own group rather than matching everything', () => {
		const stacks = stackOccurrences([ev(1, 'Quiz', 19, null), ev(2, 'Quiz', 20, 'Osvald Pub')]);
		expect(stacks).toHaveLength(2);
	});
});
