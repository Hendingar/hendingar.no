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
 * ## Every source, as far as its read vouches
 *
 * It began opt-in, for sources one run reads whole. That left every source read a page at a time
 * — most of them — keeping a deleted event until its date: Moster Amfi's calendar went on showing
 * events the venue had removed. `importers/mec` put the danger plainly: *"this importer only ever
 * reads the first page of a listing, so 'delete what the page no longer shows' would delete the
 * future."* The answer is to judge only what the page covered.
 *
 * So `recordRun` sweeps after every successful run (see `planRunSweep` and `SweepMode`). A listing
 * read in date order from today vouches for the stretch from now to the latest start it showed;
 * whatever this source had in that stretch and the page left out has gone. Beyond it, nothing is
 * judged. An importer whose read is not in date order says so with `run.sweep = 'off'`, and one
 * that reads everything says `'complete'`.
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
 * How much of a source one run vouches for — declared on the run (`IngestRun.sweep`), because only
 * the importer knows what its request returns.
 *
 * - `window`, the default: the read is in date order from today — the whole listing, or its first
 *   page — so it vouches for everything from now to the latest start it saw, and nothing after.
 *   That is what makes it safe for a source read one page at a time, which `complete` never was:
 *   an event beyond the page is not judged at all.
 * - `complete`: one run sees everything the source publishes, so it vouches for every future row.
 * - `self`: the importer calls `markGoneUpstream` itself, with sightings of its own.
 * - `off`: the read is not in date order (a shop's on-sale list, a featured strip), so absence
 *   proves nothing. Say why where you set it.
 */
export type SweepMode = 'window' | 'complete' | 'self' | 'off';

/** A candidate with its start, which a `window` sweep needs. */
export type TimedCandidate = GoneCandidate & { startsAt: Date };

/**
 * Past this, a sweep is a broken read rather than a busy day: more rows going than the run saw at
 * all, and more than a handful. A parser that silently lost half a page must not take half the
 * source's events off the site with it.
 */
const IMPLAUSIBLE_FLOOR = 5;

/**
 * What one run's sweep should do, or why it does nothing. Pure — the rule `recordRun` applies to
 * every importer, testable without a database.
 *
 * `unidentified` counts rows the run rejected without naming their external id. Such a row may be
 * perfectly alive upstream, and with no id there is no way to keep it out of the sweep, so any of
 * them turns the sweep off for that run; a later clean run catches up.
 */
export function planRunSweep(input: {
	mode: SweepMode;
	seen: ReadonlySet<string>;
	latestStart: Date | null;
	unidentified: number;
	candidates: readonly TimedCandidate[];
	now: Date;
}): { plan: GonePlan | null; skipped: string | null } {
	const { mode, seen, latestStart, unidentified, candidates, now } = input;
	if (mode === 'self' || mode === 'off') return { plan: null, skipped: null };
	if (unidentified > 0) {
		return { plan: null, skipped: `not swept: ${unidentified} row(s) rejected without an id` };
	}
	if (seen.size === 0 || latestStart === null) return { plan: null, skipped: null };

	/*
	 * A window starts at now, not at "still running": a listing in date order from today may well
	 * leave out an exhibition that opened last week, and that is no sign it closed.
	 */
	const judged =
		mode === 'complete'
			? candidates
			: candidates.filter(
					(row) =>
						row.startsAt.getTime() >= now.getTime() &&
						row.startsAt.getTime() <= latestStart.getTime()
				);

	const plan = planGoneUpstream(judged, seen);
	if (plan.mark.length > IMPLAUSIBLE_FLOOR && plan.mark.length > seen.size) {
		return {
			plan: null,
			skipped: `not swept: ${plan.mark.length} would go against ${seen.size} seen — that is a broken read, not a cancellation`
		};
	}
	return { plan, skipped: null };
}

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

	return applyGonePlan(db, planGoneUpstream(candidates, seen), now);
}

/** This source's rows that are still ahead of us, with their starts, for `planRunSweep`. */
export function goneCandidates(db: Db, sourceId: number, now: Date): Promise<TimedCandidate[]> {
	return db
		.select({
			id: events.id,
			externalId: events.externalId,
			removedUpstreamAt: events.removedUpstreamAt,
			startsAt: events.startsAt
		})
		.from(events)
		.where(
			and(eq(events.sourceId, sourceId), or(gte(events.startsAt, now), gte(events.endsAt, now)))
		);
}

/** Write a plan: mark what went, clear the mark on what came back. Nothing is deleted. */
export async function applyGonePlan(db: Db, plan: GonePlan, now: Date): Promise<SweepResult> {
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
