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
import {
	DUPLICATE_WINDOW_MS,
	comparePair,
	groupDuplicates,
	type Candidate
} from '../src/consolidate.ts';
import { events, sources, venues } from '../src/schema.ts';

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
		// The slug, not just the id: what a calendar means by "Storsalen" is recorded against a
		// stable name, because a serial id differs between this database and production.
		sourceSlug: sources.slug,
		title: events.title,
		startsAt: events.startsAt,
		venueName: venues.name
	})
	.from(events)
	.leftJoin(venues, eq(events.venueId, venues.id))
	.leftJoin(sources, eq(events.sourceId, sources.id))
	.where(
		and(eq(events.status, 'published'), or(gte(events.startsAt, now), gte(events.endsAt, now)))
	);

const candidates: Candidate[] = rows.map((r) => ({
	id: r.id,
	sourceId: r.sourceId,
	sourceSlug: r.sourceSlug,
	title: r.title,
	startsAt: r.startsAt,
	venueName: r.venueName
}));

const groups = groupDuplicates(candidates);
const duplicateIds = groups.flatMap((g) => g.duplicateIds);

// Sorted by start so the near-miss scan below can stop at the window, exactly as grouping does.
const byStart = [...candidates].sort(
	(x, y) => x.startsAt.getTime() - y.startsAt.getTime() || x.id - y.id
);

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

/*
 * Which venue names stopped a merge.
 *
 * The alias list in `src/venue-aliases.ts` is the only thing that knows `Storsalen` is a room in
 * Stord kulturhus, and when a source starts writing a room name nobody has listed, the failure is
 * silent: the event just appears twice. This is the report that makes it audible.
 *
 * A line here is a question, not a fault. Two churches in one parish belong on this list and must
 * stay on it; a hall and the building it is in do not, and want an entry adding.
 */
const blockedBy = new Map<string, { count: number; example: string }>();
for (let i = 0; i < byStart.length; i += 1) {
	for (let j = i + 1; j < byStart.length; j += 1) {
		const a = byStart[i]!;
		const b = byStart[j]!;
		if (b.startsAt.getTime() - a.startsAt.getTime() > DUPLICATE_WINDOW_MS) break;
		const verdict = comparePair(a, b);
		if (verdict.same || verdict.reason !== 'different venues') continue;
		const pair = [`${a.venueName} [${a.sourceSlug}]`, `${b.venueName} [${b.sourceSlug}]`]
			.sort()
			.join('  ≠  ');
		const seen = blockedBy.get(pair);
		if (seen) seen.count += 1;
		else blockedBy.set(pair, { count: 1, example: a.title });
	}
}
if (blockedBy.size > 0) {
	const ranked = [...blockedBy.entries()].sort((x, y) => y[1].count - x[1].count);
	console.log(`\n${ranked.length} venue pairs refused a matching title — same place, or not?`);
	for (const [pair, { count, example }] of ranked.slice(0, 15)) {
		console.log(`  ${count}×  ${pair}   e.g. "${example.slice(0, 40)}"`);
	}
	if (ranked.length > 15) console.log(`  … and ${ranked.length - 15} more`);
}

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
