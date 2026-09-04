import { describe, expect, it } from 'vitest';
import {
	SUBMISSION_TTL_HOURS,
	SUBMISSION_TTL_MS,
	isExpiredSubmission,
	submissionCutoff
} from '../src/submissions.ts';

const NOW = new Date('2026-09-04T12:00:00Z');
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 60 * 60 * 1000);

const submission = (overrides: Partial<Parameters<typeof isExpiredSubmission>[0]> = {}) => ({
	status: 'rejected',
	submissionOutcome: 'declined' as string | null,
	updatedAt: hoursAgo(1),
	...overrides
});

describe('submission expiry', () => {
	it('keeps one that is still inside the window', () => {
		expect(isExpiredSubmission(submission({ updatedAt: hoursAgo(47) }), NOW)).toBe(false);
	});

	it('expires one that is past it', () => {
		expect(isExpiredSubmission(submission({ updatedAt: hoursAgo(49) }), NOW)).toBe(true);
	});

	it('measures from the last change, so revising starts the clock over', () => {
		/*
		 * The behaviour the copy promises. `updatedAt`, not `createdAt`: somebody still working on
		 * a submission must not lose it two days after their first attempt.
		 */
		const old = submission({ updatedAt: hoursAgo(100) });
		expect(isExpiredSubmission(old, NOW)).toBe(true);
		expect(isExpiredSubmission({ ...old, updatedAt: hoursAgo(1) }, NOW)).toBe(false);
	});

	it('never expires a published event, however old', () => {
		// It is the site's content by then, not somebody's draft.
		expect(
			isExpiredSubmission(
				submission({
					status: 'published',
					submissionOutcome: 'approved',
					updatedAt: hoursAgo(10_000)
				}),
				NOW
			)
		).toBe(false);
	});

	it('never expires an import', () => {
		/*
		 * The guard that matters most. An importer decides nothing, so it sets no outcome — and a
		 * sweep that ignored this would delete the events the site is made of.
		 */
		expect(
			isExpiredSubmission(
				submission({ status: 'rejected', submissionOutcome: null, updatedAt: hoursAgo(10_000) }),
				NOW
			)
		).toBe(false);
	});

	it('agrees with the cutoff the sweep queries on', () => {
		// The reader-facing filter and the delete must not disagree, or the page lists something
		// the next sweep removes.
		const cutoff = submissionCutoff(NOW);
		expect(cutoff.getTime()).toBe(NOW.getTime() - SUBMISSION_TTL_MS);
		expect(
			isExpiredSubmission(submission({ updatedAt: new Date(cutoff.getTime() - 1) }), NOW)
		).toBe(true);
		expect(
			isExpiredSubmission(submission({ updatedAt: new Date(cutoff.getTime() + 1) }), NOW)
		).toBe(false);
	});

	it('is the number the copy says', () => {
		// Both the panel and /kø interpolate this constant, so a change here changes the promise.
		expect(SUBMISSION_TTL_HOURS).toBe(48);
	});
});
