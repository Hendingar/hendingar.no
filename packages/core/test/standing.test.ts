import { describe, expect, it } from 'vitest';
import { classifyEventKind, STANDING_SPAN_DAYS } from '../src/standing.ts';

const at = (iso: string) => new Date(iso);
const plusDays = (iso: string, days: number) =>
	new Date(new Date(iso).getTime() + days * 86_400_000);

describe('classifyEventKind', () => {
	it('calls an ordinary evening an event', () => {
		expect(classifyEventKind(at('2026-09-11T20:00:00Z'), at('2026-09-11T23:00:00Z'))).toBe('dated');
	});

	it('calls a row with no end an event', () => {
		// The ordinary shape of an imported concert: the source states when it begins and no more.
		// 331 of the 600 live rows look like this, and every one of them is an appointment.
		expect(classifyEventKind(at('2026-09-11T20:00:00Z'), null)).toBe('dated');
		expect(classifyEventKind(at('2026-09-11T20:00:00Z'), undefined)).toBe('dated');
	});

	it('keeps real multi-day events in the listing', () => {
		// Measured shapes: a weekend trip to Finse, a three-day football school, an 11-day
		// exhibition. All of them are things that start and finish, and belong under a date.
		for (const days of [2, 3, 11, 29]) {
			expect(
				classifyEventKind(at('2026-09-11T08:00:00Z'), plusDays('2026-09-11T08:00:00Z', days))
			).toBe('dated');
		}
	});

	it('calls the escape room what it is', () => {
		// The row this rule exists for: 2023-01-01 to 2027-12-31, filed under "today" every day for
		// five years because greatest(starts_at, now()) had nowhere else to put it.
		expect(classifyEventKind(at('2023-01-01T00:00:00Z'), at('2027-12-31T00:00:00Z'))).toBe(
			'standing'
		);
	});

	it('catches a season-long activity, which is how the sources that know spell it', () => {
		// aktivitetforalle's `activity` rows: "aqua gym, tysdag og torsdag, august til juni".
		// event_from 2025-08-21, event_to 2026-06-25 — ten months, so the span rule alone is enough
		// and the importer needs no special case.
		expect(classifyEventKind(at('2025-08-21T00:00:00Z'), at('2026-06-25T23:59:59Z'))).toBe(
			'standing'
		);
	});

	it('switches exactly at the threshold, not a day either side', () => {
		const start = at('2026-01-01T12:00:00Z');
		expect(classifyEventKind(start, plusDays('2026-01-01T12:00:00Z', STANDING_SPAN_DAYS - 1))).toBe(
			'dated'
		);
		expect(classifyEventKind(start, plusDays('2026-01-01T12:00:00Z', STANDING_SPAN_DAYS))).toBe(
			'standing'
		);
	});

	it('does not care what time of day it starts', () => {
		// Midnight was the tempting signal and it is the wrong one — eleven live rows start between
		// 00:00 and 02:00 and are real events.
		expect(classifyEventKind(at('2026-09-11T00:00:00Z'), at('2026-09-11T04:00:00Z'))).toBe('dated');
	});
});
