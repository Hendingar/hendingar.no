import { describe, expect, it } from 'vitest';
import { publicSubmissionTitle, WITHHELD_TITLE } from '../src/verification.ts';

/**
 * The rule that a rejected submission's text never reaches a page.
 *
 * This was previously guarded only by an e2e assertion that a rejected row was visible on
 * /datasamling. That assertion raced the submission specs: the log shows the five most recent
 * rows, and a spec that submits a weekly recurrence adds enough rows to push the seeded rejected
 * one off the page. Playwright runs spec files in parallel, so it could fail depending on which
 * file won — a flaky test, which CLAUDE.md rule 6 rates worse than no test at all.
 */
describe('publicSubmissionTitle', () => {
	it('withholds the title of a rejected submission', () => {
		expect(publicSubmissionTitle('rejected', 'KJØP BILLIGE KLOKKER NO!!!')).toBeNull();
	});

	it('keeps the title of anything not rejected', () => {
		for (const status of ['pending', 'published', 'draft']) {
			expect(publicSubmissionTitle(status, 'Quiz på Kaikanten')).toBe('Quiz på Kaikanten');
		}
	});

	it('leaves an already-missing title missing rather than inventing one', () => {
		expect(publicSubmissionTitle('pending', null)).toBeNull();
	});

	it('names the placeholder once, so the UI and this rule cannot drift', () => {
		expect(WITHHELD_TITLE).toBe('Tilbakehalden tittel');
	});
});
