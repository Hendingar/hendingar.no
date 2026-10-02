import { and, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import type { Db } from './db.ts';
import { events } from './schema.ts';

/**
 * Noticing that a source has stopped listing an event.
 *
 * Nothing used to. Every importer inserts and updates and never looks at what is no longer there,
 * so an event cancelled upstream stayed on the site until its own date passed — which is this
 * index telling somebody to turn up to something that is not happening. That is the failure a
 * listing of other people's calendars is most likely to produce, and the one it can least afford.
 *
 * ## Only where the fetch is complete
 *
 * This is safe exactly when a run sees EVERYTHING the source publishes. `importers/mec` says why,
 * from the other side: *"this importer only ever reads the first page of a listing, so 'delete what
 * the page no longer shows' would delete the future."* A source read through a window — one page,
 * one month, one year — will always be missing rows that are perfectly alive.
 *
 * So it is opt-in per source, declared where the fetch is declared, and the opt-in is a statement
 * about the request rather than a preference: `listingIsComplete` means "one run sees the whole
 * collection".
 *
 * ## A mark, not a delete
 *
 * The row stays. Its page stays, and says what happened; `hearts` and `views` cascade from
 * `events`, so deleting would take somebody's saved event and the view count with it, and break
 * every link that had been shared. Listings drop it, which is the part that matters.
 *
 * ## It heals
 *
 * A source that blips for one run and comes back clears the mark on the next, because the mark is
 * recomputed from what each run saw rather than accumulated. That is also why a run that saw
 * nothing at all must never sweep — see `planGoneUpstream`.
 */

/** The rows a sweep considers: this source's, and still ahead of us. */
export type GoneCandidate = {
	id: number;
	externalId: string | null;
	removedUpstreamAt: Date | null;
};

export type GonePlan = {
	/** Rows to mark as gone: upcoming, ours, and not in this run's sightings. */
	mark: number[];
	/** Rows the source is listing again, whose mark must be cleared. */
	restore: number[];
};

/**
 * What a run should change, given what it saw. Pure, so the rule can be tested without a database.
 *
 * `seen` is the set of `external_id`s the run actually mapped — not the rows it fetched. A row the
 * source still lists but which we refuse to map (no start time, say) is NOT seen here, and would
 * be marked gone on a technicality. That is the one sharp edge in this design, and the reason the
 * importers pass the ids they mapped AND the ids they deliberately skipped.
 */
export function planGoneUpstream(
	candidates: readonly GoneCandidate[],
	seen: ReadonlySet<string>
): GonePlan {
	/*
	 * A run that saw nothing sweeps nothing.
	 *
	 * An upstream that answers 200 with an empty collection is indistinguishable, from here, from
	 * one that has genuinely cancelled everything — and the second never happens while the first is
	 * an ordinary outage. Refusing to act on zero is what stops one bad response emptying a source.
	 */
	if (seen.size === 0) return { mark: [], restore: [] };

	const mark: number[] = [];
	const restore: number[] = [];
	for (const row of candidates) {
		const present = row.externalId !== null && seen.has(row.externalId);
		if (!present && row.removedUpstreamAt === null) mark.push(row.id);
		if (present && row.removedUpstreamAt !== null) restore.push(row.id);
	}
	return { mark, restore };
}

export type SweepResult = { marked: number; restored: number };

/**
 * Apply the plan for one source.
 *
 * Scoped to rows that have not happened yet: a source tidying last month's events out of its
 * listing is housekeeping, not a cancellation, and marking those would fill the table with noise
 * that says nothing to anybody.
 */
export async function markGoneUpstream(
	db: Db,
	options: { sourceId: number; seen: ReadonlySet<string>; now: Date }
): Promise<SweepResult> {
	const { sourceId, seen, now } = options;

	const candidates = await db
		.select({
			id: events.id,
			externalId: events.externalId,
			removedUpstreamAt: events.removedUpstreamAt
		})
		.from(events)
		.where(
			and(
				eq(events.sourceId, sourceId),
				// Still ahead of us, by the same reckoning every listing uses: an event that has
				// started but not ended is still happening.
				or(gte(events.startsAt, now), gte(events.endsAt, now))
			)
		);

	const plan = planGoneUpstream(candidates, seen);

	if (plan.mark.length > 0) {
		await db
			.update(events)
			.set({ removedUpstreamAt: now, updatedAt: now })
			.where(inArray(events.id, plan.mark));
	}
	if (plan.restore.length > 0) {
		await db
			.update(events)
			.set({ removedUpstreamAt: null, updatedAt: now })
			.where(inArray(events.id, plan.restore));
	}

	return { marked: plan.mark.length, restored: plan.restore.length };
}

/**
 * The listing condition: an event the source still lists.
 *
 * One exported predicate rather than `isNull(events.removedUpstreamAt)` written out in each of the
 * dozen queries that need it — the kind of clause that gets added to eleven of them and forgotten
 * in the twelfth, where it shows up as one page still advertising a cancelled concert.
 */
export const stillListedUpstream = () => isNull(events.removedUpstreamAt);
