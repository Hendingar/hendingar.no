import { describe, expect, it } from 'vitest';
import {
	JOB_OVERDUE_MS,
	JOB_TIMEOUT_MS,
	jobHealth,
	jobMessage,
	jobStatus
} from '../src/ingest-job.ts';
import { jobIdFrom } from '../src/ingest-cli.ts';

describe('jobStatus', () => {
	it('is success when every source ran and every step held', () => {
		expect(jobStatus({ sourcesRun: 25, sourcesFailed: 0, failedSteps: [] })).toBe('success');
	});

	it('is partial when one source failed and the rest imported — the 2026-10-21 night', () => {
		expect(jobStatus({ sourcesRun: 25, sourcesFailed: 1, failedSteps: ['innhenting'] })).toBe(
			'partial'
		);
	});

	it('is failed when no source ran cleanly, which is an outage and not a bad source', () => {
		expect(jobStatus({ sourcesRun: 25, sourcesFailed: 25, failedSteps: ['innhenting'] })).toBe(
			'failed'
		);
		expect(jobStatus({ sourcesRun: 0, sourcesFailed: 0, failedSteps: ['innhenting'] })).toBe(
			'failed'
		);
	});

	it('is failed when a step the listing depends on failed', () => {
		expect(jobStatus({ sourcesRun: 25, sourcesFailed: 0, failedSteps: ['samanslåing'] })).toBe(
			'failed'
		);
	});

	it('does not let the optional kurator colour the night', () => {
		expect(jobStatus({ sourcesRun: 25, sourcesFailed: 0, failedSteps: ['kurator'] })).toBe(
			'success'
		);
	});
});

describe('jobMessage', () => {
	it('is null on a clean night', () => {
		expect(jobMessage([], [])).toBeNull();
	});

	it('names the failed sources, and the failed steps other than the importers themselves', () => {
		expect(jobMessage(['innhenting', 'kurator'], ['Fitjar kommune'])).toBe(
			'feila: Fitjar kommune; steg som feila: kurator'
		);
	});
});

describe('jobHealth', () => {
	const start = new Date('2026-10-21T05:00:00Z');
	const after = (ms: number) => new Date(start.getTime() + ms);

	it('says nothing has run when there is no row', () => {
		expect(jobHealth(null, start)).toEqual({ state: 'none' });
	});

	it('trusts a running row within the timeout', () => {
		expect(
			jobHealth({ startedAt: start, finishedAt: null, status: 'running' }, after(60_000))
		).toEqual({
			state: 'running',
			since: start
		});
	});

	it('reads a running row past the timeout as a job that was killed', () => {
		const health = jobHealth(
			{ startedAt: start, finishedAt: null, status: 'running' },
			after(JOB_TIMEOUT_MS + 1)
		);
		expect(health).toEqual({ state: 'interrupted', since: start, overdue: false });
	});

	it('reports a finished job at its finish, and late once the next should have started', () => {
		const finishedAt = after(9 * 60_000);
		const row = { startedAt: start, finishedAt, status: 'partial' as const };
		expect(jobHealth(row, after(60 * 60_000))).toEqual({
			state: 'done',
			status: 'partial',
			at: finishedAt,
			overdue: false
		});
		expect(jobHealth(row, after(JOB_OVERDUE_MS + 1))).toMatchObject({ overdue: true });
	});
});

describe('jobIdFrom', () => {
	it('takes a positive integer and nothing else', () => {
		expect(jobIdFrom('42')).toBe(42);
		expect(jobIdFrom(undefined)).toBeNull();
		expect(jobIdFrom('')).toBeNull();
		expect(jobIdFrom('0')).toBeNull();
		expect(jobIdFrom('4; drop table')).toBeNull();
	});
});
