import { describe, expect, it } from 'vitest';
import {
	DATE_LOCALE,
	DEFAULT_TIME_ZONE,
	formatEventTime,
	machineDateTime
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
