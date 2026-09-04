/**
 * How long an unapproved submission lives.
 *
 * There is no review queue and nobody to work through one, so a submission that does not pass has
 * exactly one route forward: the person who sent it corrects it in `/kø` and sends it again. If
 * they never do, it is deleted rather than kept indefinitely — a database of other people's
 * abandoned drafts is not something to hold on to, and keeping rejected spam forever gives a
 * spammer a permanent record on our disk.
 *
 * The clock runs from the last time it changed, not from when it arrived, so revising a submission
 * buys it another two days. That is the behaviour the copy promises and the reason `updatedAt` is
 * the column this reads.
 */
export const SUBMISSION_TTL_HOURS = 48;

export const SUBMISSION_TTL_MS = SUBMISSION_TTL_HOURS * 60 * 60 * 1000;

/**
 * Is this submission past its time?
 *
 * Pure, so both the reader-facing filter and the sweep that actually deletes rows agree on the
 * answer — the alternative is a page that still lists something the next sweep will remove.
 */
export function isExpiredSubmission(
	submission: { status: string; submissionOutcome: string | null; updatedAt: Date },
	now: Date = new Date()
): boolean {
	// Published events never expire, and neither do imports: an importer decides nothing, so it
	// sets no outcome, and its rows are the site's content rather than somebody's draft.
	if (submission.status === 'published') return false;
	if (submission.submissionOutcome === null) return false;
	return now.getTime() - submission.updatedAt.getTime() > SUBMISSION_TTL_MS;
}

/** The cut-off instant: anything last touched before this has expired. */
export function submissionCutoff(now: Date = new Date()): Date {
	return new Date(now.getTime() - SUBMISSION_TTL_MS);
}
