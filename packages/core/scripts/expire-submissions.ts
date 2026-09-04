import { and, eq, isNotNull, lt, ne } from 'drizzle-orm';
import { createDb } from '../src/db.ts';
import { events } from '../src/schema.ts';
import { SUBMISSION_TTL_HOURS, submissionCutoff } from '../src/submissions.ts';

/**
 * Delete submissions nobody came back to fix.
 *
 * `pnpm expire`. Runs after the importers, on the same schedule, because it needs a database and
 * nothing else — and because a sweep that only runs when somebody remembers to run it is not a
 * retention policy, it is a hope.
 *
 * Deliberately narrow. It only ever touches rows that carry a `submission_outcome`, which imports
 * never set, and never a published one. A bug here would delete the site's content, so the query
 * says so three times rather than relying on one clause being right.
 */
const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set. Run `pnpm db:up` locally, or set it in CI.');
	process.exit(1);
}

const db = createDb(url);
const cutoff = submissionCutoff();

const deleted = await db
	.delete(events)
	.where(
		and(
			// A human submission, never an import.
			isNotNull(events.submissionOutcome),
			// Never something that is on the site.
			ne(events.status, 'published'),
			eq(events.status, 'rejected'),
			// Untouched for longer than the window. Revising sets `updatedAt`, so a person who is
			// still working on it keeps it alive.
			lt(events.updatedAt, cutoff)
		)
	)
	.returning({ id: events.id });

console.log(
	`expired ${deleted.length} submissions last touched before ${cutoff.toISOString()} ` +
		`(${SUBMISSION_TTL_HOURS}h)`
);
