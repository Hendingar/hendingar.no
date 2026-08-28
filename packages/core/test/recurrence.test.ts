import { describe, expect, it } from 'vitest';
import {
	describeRecurrence,
	expandRecurrence,
	matchesRecurrence,
	toRRule,
	type Recurrence
} from '../src/recurrence.ts';
import { formatEventClock } from '../src/datetime.ts';

const weekly = (weekdays: Recurrence['weekdays'], over: Partial<Recurrence> = {}): Recurrence => ({
	freq: 'weekly',
	interval: 1,
	weekdays,
	nth: null,
	until: null,
	...over
});

describe('expandRecurrence', () => {
	it('produces every matching weekday in the window', () => {
		// 2026-10-01 is a Thursday; the window covers five of them.
		const out = expandRecurrence({
			recurrence: weekly([4]),
			anchorDate: '2026-10-01',
			startTime: '12:00',
			endTime: '17:00',
			from: '2026-10-01',
			to: '2026-10-31'
		});
		expect(out.map((o) => o.localDate)).toEqual([
			'2026-10-01',
			'2026-10-08',
			'2026-10-15',
			'2026-10-22',
			'2026-10-29'
		]);
	});

	it('keeps the wall clock across a DST transition', () => {
		// Norway leaves summer time on 2026-10-25. A 12:00 Thursday event is 12:00 on both sides,
		// which means the two instants are an hour apart in UTC — the bug this guards against is
		// arithmetic done in local time, which silently shifts every occurrence after the change.
		const out = expandRecurrence({
			recurrence: weekly([4]),
			anchorDate: '2026-10-22',
			startTime: '12:00',
			from: '2026-10-22',
			to: '2026-10-29'
		});
		expect(out).toHaveLength(2);
		const [before, after] = out;
		expect(before!.startsAt.toISOString()).toBe('2026-10-22T10:00:00.000Z'); // UTC+2
		expect(after!.startsAt.toISOString()).toBe('2026-10-29T11:00:00.000Z'); // UTC+1
		for (const occurrence of out) {
			expect(formatEventClock(occurrence.startsAt, 'Europe/Oslo')).toBe('12:00');
		}
	});

	it('counts the interval from the anchor, not from the window', () => {
		const out = expandRecurrence({
			recurrence: weekly([4], { interval: 2 }),
			anchorDate: '2026-10-01',
			startTime: '19:00',
			// The window starts a week in, on a week the series does not run.
			from: '2026-10-06',
			to: '2026-10-31'
		});
		expect(out.map((o) => o.localDate)).toEqual(['2026-10-15', '2026-10-29']);
	});

	it('handles several weekdays in one rule', () => {
		const out = expandRecurrence({
			recurrence: weekly([2, 4]),
			anchorDate: '2026-09-01',
			startTime: '20:00',
			from: '2026-09-01',
			to: '2026-09-11'
		});
		expect(out.map((o) => o.localDate)).toEqual([
			'2026-09-01',
			'2026-09-03',
			'2026-09-08',
			'2026-09-10'
		]);
	});

	it('resolves the nth weekday of the month', () => {
		const out = expandRecurrence({
			recurrence: { freq: 'monthly', interval: 1, weekdays: [1], nth: 1, until: null },
			anchorDate: '2026-09-01',
			startTime: '18:30',
			from: '2026-09-01',
			to: '2026-11-30'
		});
		expect(out.map((o) => o.localDate)).toEqual(['2026-09-07', '2026-10-05', '2026-11-02']);
	});

	it('resolves the last weekday of the month, which is not always the fifth', () => {
		const out = expandRecurrence({
			recurrence: { freq: 'monthly', interval: 1, weekdays: [1], nth: -1, until: null },
			anchorDate: '2026-09-01',
			startTime: '18:30',
			from: '2026-09-01',
			to: '2026-11-30'
		});
		expect(out.map((o) => o.localDate)).toEqual(['2026-09-28', '2026-10-26', '2026-11-30']);
	});

	it('runs daily with an interval', () => {
		const out = expandRecurrence({
			recurrence: { freq: 'daily', interval: 3, weekdays: [], nth: null, until: null },
			anchorDate: '2026-07-01',
			startTime: '10:00',
			from: '2026-07-01',
			to: '2026-07-10'
		});
		expect(out.map((o) => o.localDate)).toEqual([
			'2026-07-01',
			'2026-07-04',
			'2026-07-07',
			'2026-07-10'
		]);
	});

	it('stops at `until`, even when the window runs longer', () => {
		const out = expandRecurrence({
			recurrence: weekly([4], { until: '2026-10-16' }),
			anchorDate: '2026-10-01',
			startTime: '12:00',
			from: '2026-10-01',
			to: '2026-12-31'
		});
		expect(out.map((o) => o.localDate)).toEqual(['2026-10-01', '2026-10-08', '2026-10-15']);
	});

	it('never starts before the anchor', () => {
		const out = expandRecurrence({
			recurrence: weekly([4]),
			anchorDate: '2026-10-15',
			startTime: '12:00',
			from: '2026-10-01',
			to: '2026-10-31'
		});
		expect(out.map((o) => o.localDate)).toEqual(['2026-10-15', '2026-10-22', '2026-10-29']);
	});

	it('honours the limit, so a bad rule cannot cause an unbounded write', () => {
		const out = expandRecurrence({
			recurrence: { freq: 'daily', interval: 1, weekdays: [], nth: null, until: null },
			anchorDate: '2026-01-01',
			startTime: '12:00',
			from: '2026-01-01',
			to: '2026-12-31',
			limit: 5
		});
		expect(out).toHaveLength(5);
	});

	it('respects the venue timezone rather than the server', () => {
		const out = expandRecurrence({
			recurrence: weekly([4]),
			anchorDate: '2026-07-02',
			startTime: '20:00',
			timeZone: 'Europe/Helsinki',
			from: '2026-07-02',
			to: '2026-07-02'
		});
		// 20:00 in Helsinki summer time is 17:00Z, not 18:00Z as it would be in Oslo.
		expect(out[0]!.startsAt.toISOString()).toBe('2026-07-02T17:00:00.000Z');
	});

	it('returns nothing when the window is entirely before the anchor', () => {
		expect(
			expandRecurrence({
				recurrence: weekly([4]),
				anchorDate: '2026-10-01',
				startTime: '12:00',
				from: '2026-08-01',
				to: '2026-09-01'
			})
		).toEqual([]);
	});
});

describe('matchesRecurrence', () => {
	it('rejects a date before the anchor and after `until`', () => {
		const rule = weekly([4], { until: '2026-10-16' });
		expect(matchesRecurrence(rule, '2026-10-01', '2026-09-24')).toBe(false);
		expect(matchesRecurrence(rule, '2026-10-01', '2026-10-08')).toBe(true);
		expect(matchesRecurrence(rule, '2026-10-01', '2026-10-22')).toBe(false);
	});

	it('rejects the wrong weekday', () => {
		expect(matchesRecurrence(weekly([4]), '2026-10-01', '2026-10-02')).toBe(false);
	});
});

describe('describeRecurrence', () => {
	it('reads as one Nynorsk phrase', () => {
		expect(describeRecurrence(weekly([4]))).toBe('kvar torsdag');
		expect(describeRecurrence(weekly([2], { interval: 2 }))).toBe('annakvar tysdag');
		expect(describeRecurrence(weekly([1, 3, 5]))).toBe('kvar måndag, onsdag og fredag');
		expect(
			describeRecurrence({ freq: 'monthly', interval: 1, weekdays: [1], nth: 1, until: null })
		).toBe('første måndag i månaden');
		expect(
			describeRecurrence({ freq: 'monthly', interval: 1, weekdays: [5], nth: -1, until: null })
		).toBe('siste fredag i månaden');
		expect(
			describeRecurrence({ freq: 'daily', interval: 1, weekdays: [], nth: null, until: null })
		).toBe('kvar dag');
		expect(describeRecurrence(weekly([4], { until: '2026-12-18' }))).toBe(
			'kvar torsdag, til 2026-12-18'
		);
	});
});

describe('toRRule', () => {
	it('emits RFC 5545 for the iCal feed', () => {
		expect(toRRule(weekly([4]))).toBe('RRULE:FREQ=WEEKLY;BYDAY=TH');
		expect(toRRule(weekly([2], { interval: 2 }))).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU');
		expect(toRRule(weekly([4], { until: '2026-12-18' }))).toBe(
			'RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261218'
		);
		expect(toRRule({ freq: 'monthly', interval: 1, weekdays: [1], nth: 1, until: null })).toBe(
			'RRULE:FREQ=MONTHLY;BYDAY=1MO'
		);
		expect(toRRule({ freq: 'daily', interval: 1, weekdays: [], nth: null, until: null })).toBe(
			'RRULE:FREQ=DAILY'
		);
	});
});
