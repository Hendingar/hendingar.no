import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

/**
 * Wait until the database has every migration this checkout ships, then get out of the way.
 *
 * `pnpm await-migrations`. The ingest runs it before any importer, because the deploy and the
 * ingest are two workflows that do not know about each other — and on 2026-10-13 they met. The
 * deploy that added `events.trail` started at 12:27 and applied its migration minutes later; the
 * scheduled ingest, which GitHub fires hours after its 05:00 cron and so lands squarely in the
 * working day, checked out the same commit at 12:30 and ran the DNT importer at 12:32 against a
 * table without the column. Both DNT sources failed, and the trips the change was for kept
 * drawing nothing until the next day.
 *
 * Waiting rather than migrating: drizzle's migrator takes no lock, so an ingest applying the same
 * migration as a running deploy would race it and fail one of the two on "already exists". The
 * deploy owns the schema; the ingest only needs to know it has caught up.
 *
 * Drizzle records each applied migration with its journal timestamp (`created_at` is the entry's
 * `when`), so "caught up" is: the newest applied timestamp is at least this checkout's newest.
 * A database AHEAD of the checkout is fine — expand/contract (ADR 0010) means old code runs
 * against a newer schema by design.
 */
const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set. Run `pnpm db:up` locally, or set it in CI.');
	process.exit(1);
}

/** A deploy measured 12 minutes end to end on 2026-10-13; this is about twice that. */
const TIMEOUT_MS = Number(process.env.AWAIT_MIGRATIONS_TIMEOUT_MS ?? 25 * 60_000);
const POLL_MS = 15_000;

type Journal = { entries: { when: number; tag: string }[] };
const journal: Journal = JSON.parse(
	readFileSync(fileURLToPath(new URL('../migrations/meta/_journal.json', import.meta.url)), 'utf8')
);
const newest = journal.entries.at(-1);
if (!newest) {
	console.log('await-migrations: this checkout ships no migrations');
	process.exit(0);
}

const sql = postgres(url, { max: 1, connect_timeout: 10 });
const started = Date.now();
try {
	for (;;) {
		const [row] = await sql<{ applied: string | null }[]>`
			select max(created_at)::text as applied from drizzle.__drizzle_migrations
		`;
		const applied = row?.applied ? Number(row.applied) : 0;
		if (applied >= newest.when) {
			console.log(`await-migrations: database has ${newest.tag}`);
			break;
		}
		const waited = Date.now() - started;
		if (waited >= TIMEOUT_MS) {
			console.error(
				`await-migrations: database is still behind ${newest.tag} after ${Math.round(waited / 60_000)} min. ` +
					'Is a deploy stuck, or did one fail before migrating? Not running the importers against it.'
			);
			process.exitCode = 1;
			break;
		}
		console.log(
			`await-migrations: waiting for ${newest.tag} — a deploy is probably still migrating`
		);
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
} finally {
	await sql.end();
}
