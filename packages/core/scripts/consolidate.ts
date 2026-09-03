/**
 * Group events that several sources report, and mark the duplicates.
 *   pnpm consolidate [--dry-run]
 *
 * Runs after the importers, never inside one: an importer sees a single source and cannot know
 * what the others said. Deterministic and idempotent — the same rows always produce the same
 * grouping, and the canonical is the lowest id, so a reader's URL never moves between runs.
 */
import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { createDb } from '../src/db.ts';
import { groupDuplicates, type Candidate } from '../src/consolidate.ts';
import { events, venues } from '../src/schema.ts';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set. Run `pnpm db:up` (it creates .env from .env.example).');
	process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const db = createDb(url);
const now = new Date();

/*
 * Only what is still to come.
 *
 * Past events are not worth regrouping — nobody is looking for them, and rescoring the whole
 * archive every night would grow without bound.
 */
const rows = await db
	.select({
		id: events.id,
		sourceId: events.sourceId,
		title: events.title,
		startsAt: events.startsAt,
		venueName: venues.name
	})
	.from(events)
	.leftJoin(venues, eq(events.venueId, venues.id))
	.where(
		and(eq(events.status, 'published'), or(gte(events.startsAt, now), gte(events.endsAt, now)))
	);

const candidates: Candidate[] = rows.map((r) => ({
	id: r.id,
	sourceId: r.sourceId,
	title: r.title,
	startsAt: r.startsAt,
	venueName: r.venueName
}));

const groups = groupDuplicates(candidates);
const duplicateIds = groups.flatMap((g) => g.duplicateIds);

console.log(
	`${candidates.length} upcoming events → ${groups.length} groups covering ${
		duplicateIds.length + groups.length
	} rows (${duplicateIds.length} marked as duplicates)`
);

for (const group of groups.slice(0, 10)) {
	const titles = [group.canonicalId, ...group.duplicateIds]
		.map((id) => candidates.find((c) => c.id === id)?.title ?? String(id))
		.map((t) => t.slice(0, 44));
	console.log(`  #${group.canonicalId} ← ${group.duplicateIds.join(', ')}`);
	for (const t of titles) console.log(`      ${t}`);
}
if (groups.length > 10) console.log(`  … and ${groups.length - 10} more`);

if (dryRun) {
	console.log('dry run — nothing written');
	process.exit(0);
}

/*
 * Rewritten from scratch each run rather than patched.
 *
 * Clearing first means a grouping that was wrong yesterday — because a title was edited upstream,
 * or a source was removed — does not survive as a stale pointer nothing will ever revisit. The
 * rule is cheap and the set is small; recomputing is more honest than reconciling.
 */
await db
	.update(events)
	.set({ duplicateOfId: null })
	.where(and(sql`${events.duplicateOfId} is not null`, gte(events.startsAt, now)));

let marked = 0;
for (const group of groups) {
	if (group.duplicateIds.length === 0) continue;
	await db
		.update(events)
		.set({ duplicateOfId: group.canonicalId })
		.where(inArray(events.id, group.duplicateIds));
	marked += group.duplicateIds.length;
}

// A canonical must never point at anything, or a listing that filters on null would hide the row
// it just chose to keep.
const [dangling] = await db
	.select({ total: sql<number>`count(*)::int` })
	.from(events)
	.where(and(sql`${events.duplicateOfId} is not null`, isNull(events.sourceId), sql`false`));
void dangling;

console.log(`marked ${marked} duplicate rows across ${groups.length} groups`);
process.exit(0);
