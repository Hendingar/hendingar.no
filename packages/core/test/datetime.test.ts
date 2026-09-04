import { describe, expect, it } from 'vitest';
import {
	DATE_LOCALE,
	DEFAULT_TIME_ZONE,
	formatEventTime,
	formatTimeDigits,
	instantToZonedWallClock,
	machineDateTime,
	zonedWallClockToInstant
} from '../src/datetime.ts';

describe('formatEventTime', () => {
	/**
	 * Regression: the UI formatted every event in a hardcoded Europe/Oslo. A 20:00 concert in
	 * Helsinki rendered as 19:00 and one in Lisbon as 21:00 — wrong for the "across Europe" scope
	 * the product advertises.
	 */
	it('renders the wall-clock time at the venue, not at the server', () => {
		const cases: [string, string, string][] = [
			['2026-09-12T20:00:00+02:00', 'Europe/Oslo', '20:00'],
			['2026-09-12T20:00:00+03:00', 'Europe/Helsinki', '20:00'],
			['2026-09-12T20:00:00+01:00', 'Europe/Lisbon', '20:00']
		];
		for (const [iso, zone, expected] of cases) {
			expect(formatEventTime(new Date(iso), zone)).toContain(expected);
		}
	});

	it('does not agree between zones for the same instant', () => {
		const instant = new Date('2026-09-12T20:00:00+02:00');
		expect(formatEventTime(instant, 'Europe/Oslo')).not.toBe(
			formatEventTime(instant, 'Europe/Helsinki')
		);
	});

	it('falls back to the pilot zone when a venue has none', () => {
		const instant = new Date('2026-09-12T20:00:00+02:00');
		expect(formatEventTime(instant, null)).toBe(formatEventTime(instant, DEFAULT_TIME_ZONE));
	});

	/**
	 * Regression: the UI asked for `nn-NO`, which Node supports but browser ICU does not. Chromium
	 * silently fell back to the visitor's locale, so an English browser rendered `9/12/2026` for an
	 * event on 12 September — a three-month misreading. Whatever locale we use must be one that is
	 * actually resolvable, or the server and the client disagree.
	 */
	it('uses a locale the runtime can actually resolve', () => {
		expect(Intl.DateTimeFormat.supportedLocalesOf([DATE_LOCALE])).toEqual([DATE_LOCALE]);
		expect(new Intl.DateTimeFormat(DATE_LOCALE).resolvedOptions().locale).toMatch(/^nb/);
	});

	it('formats Norwegian day-first, not US month-first', () => {
		// 12 September must never render as 9/12.
		const out = formatEventTime(new Date('2026-09-12T20:00:00+02:00'), 'Europe/Oslo');
		expect(out).not.toMatch(/^9\//);
		expect(out).toMatch(/12/);
	});

	it('full style carries the year', () => {
		expect(formatEventTime(new Date('2026-09-12T20:00:00+02:00'), 'Europe/Oslo', 'full')).toContain(
			'2026'
		);
	});
});

describe('machineDateTime', () => {
	it('emits a valid datetime attribute value for the instant', () => {
		expect(machineDateTime(new Date('2026-09-12T20:00:00+02:00'))).toBe('2026-09-12T18:00:00.000Z');
	});
});

describe('zonedWallClockToInstant', () => {
	it('turns a poster time into the right instant in winter (CET, +01:00)', () => {
		expect(zonedWallClockToInstant('2026-01-15', '20:00', 'Europe/Oslo').toISOString()).toBe(
			'2026-01-15T19:00:00.000Z'
		);
	});

	it('and in summer (CEST, +02:00)', () => {
		expect(zonedWallClockToInstant('2026-07-15', '20:00', 'Europe/Oslo').toISOString()).toBe(
			'2026-07-15T18:00:00.000Z'
		);
	});

	it('handles a different zone entirely', () => {
		expect(zonedWallClockToInstant('2026-07-15', '20:00', 'Europe/Helsinki').toISOString()).toBe(
			'2026-07-15T17:00:00.000Z'
		);
	});

	/**
	 * The case a single-pass offset lookup gets wrong: an evening the day before a spring-forward,
	 * where the naive UTC guess lands on the far side of the transition.
	 */
	it('is correct either side of a DST transition', () => {
		// Norway springs forward 2026-03-29 at 02:00 local.
		expect(zonedWallClockToInstant('2026-03-28', '23:30', 'Europe/Oslo').toISOString()).toBe(
			'2026-03-28T22:30:00.000Z'
		);
		expect(zonedWallClockToInstant('2026-03-29', '12:00', 'Europe/Oslo').toISOString()).toBe(
			'2026-03-29T10:00:00.000Z'
		);
	});

	it('round-trips through the formatter', () => {
		const instant = zonedWallClockToInstant('2026-07-15', '20:00', 'Europe/Oslo');
		expect(formatEventTime(instant, 'Europe/Oslo')).toContain('20:00');
	});

	it('rejects nonsense rather than producing an Invalid Date', () => {
		expect(() => zonedWallClockToInstant('ikkje ein dato', '20:00', 'Europe/Oslo')).toThrow();
	});
});

describe('formatTimeDigits', () => {
	it('builds a 24-hour clock from a two-digit hour', () => {
		expect(formatTimeDigits('1')).toBe('1');
		expect(formatTimeDigits('19')).toBe('19');
		expect(formatTimeDigits('193')).toBe('19:3');
		expect(formatTimeDigits('1930')).toBe('19:30');
	});

	it('treats a leading 3-9 as a single-digit hour', () => {
		// There is no 30:00, so 9-3-0 can only mean 09:30. Without this a numeric keypad user
		// typing 930 would get "90:3".
		expect(formatTimeDigits('9')).toBe('9');
		expect(formatTimeDigits('93')).toBe('09:3');
		expect(formatTimeDigits('930')).toBe('09:30');
		expect(formatTimeDigits('7')).toBe('7');
		expect(formatTimeDigits('700')).toBe('07:00');
	});

	it('ignores anything that is not a digit, so re-typing over a colon works', () => {
		expect(formatTimeDigits('19:30')).toBe('19:30');
		expect(formatTimeDigits('19:3')).toBe('19:3');
		expect(formatTimeDigits('kl 19.30')).toBe('19:30');
	});

	it('never exceeds four digits', () => {
		expect(formatTimeDigits('193045')).toBe('19:30');
	});

	it('returns empty for empty input, so the field can be cleared', () => {
		expect(formatTimeDigits('')).toBe('');
		expect(formatTimeDigits('abc')).toBe('');
	});
});

describe('instantToZonedWallClock', () => {
	it('round-trips a wall clock through an instant and back', () => {
		// The property that matters: what somebody typed is what they see when they come back.
		for (const [date, time] of [
			['2026-09-12', '20:00'],
			['2026-12-26', '20:00'],
			['2027-03-28', '03:30']
		] as const) {
			const instant = zonedWallClockToInstant(date, time, 'Europe/Oslo');
			expect(instantToZonedWallClock(instant, 'Europe/Oslo')).toEqual({ date, time });
		}
	});

	it('renders in the venue’s zone, not the server’s', () => {
		/*
		 * 19:00Z is 20:00 in Oslo and 21:00 in Helsinki. Formatting in the server's zone is how a
		 * concert ends up an hour out for everyone deploying outside Norway.
		 */
		const instant = new Date('2026-09-12T19:00:00Z');
		expect(instantToZonedWallClock(instant, 'Europe/Oslo').time).toBe('21:00');
		expect(instantToZonedWallClock(instant, 'UTC').time).toBe('19:00');
	});

	it('gives the date shape an input[type=date] requires', () => {
		expect(instantToZonedWallClock(new Date('2026-01-05T12:00:00Z'), 'Europe/Oslo').date).toBe(
			'2026-01-05'
		);
	});
});
