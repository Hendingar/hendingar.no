import { describe, expect, it } from 'vitest';
import { describeCron, freshness, nextCronRun } from '../src/schedule.ts';

describe('describeCron', () => {
	it('describes the daily form we actually use', () => {
		expect(describeCron('0 5 * * *')).toBe('dagleg 05:00 UTC');
		expect(describeCron('30 22 * * *')).toBe('dagleg 22:30 UTC');
	});

	it('returns null rather than guessing at anything else', () => {
		for (const cron of ['*/5 * * * *', '0 5 * * 1', '0 5 1 * *', 'nonsense', '', null]) {
			expect(describeCron(cron)).toBeNull();
		}
	});
});

describe('nextCronRun', () => {
	it('finds today when the time has not passed', () => {
		expect(nextCronRun('0 5 * * *', new Date('2026-08-28T04:00:00Z'))?.toISOString()).toBe(
			'2026-08-28T05:00:00.000Z'
		);
	});

	it('rolls to tomorrow when it has', () => {
		expect(nextCronRun('0 5 * * *', new Date('2026-08-28T05:00:00Z'))?.toISOString()).toBe(
			'2026-08-29T05:00:00.000Z'
		);
	});

	it('rolls across a month boundary', () => {
		expect(nextCronRun('0 5 * * *', new Date('2026-08-31T23:00:00Z'))?.toISOString()).toBe(
			'2026-09-01T05:00:00.000Z'
		);
	});
});

describe('freshness', () => {
	const now = new Date('2026-08-28T12:00:00Z');
	it('grades against the schedule', () => {
		expect(freshness(null, '0 5 * * *', now)).toBe('never');
		expect(freshness(new Date('2026-08-28T05:00:00Z'), '0 5 * * *', now)).toBe('fresh');
		expect(freshness(new Date('2026-08-27T00:00:00Z'), '0 5 * * *', now)).toBe('late');
		expect(freshness(new Date('2026-08-20T05:00:00Z'), '0 5 * * *', now)).toBe('stale');
	});
});
