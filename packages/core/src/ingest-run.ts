/**
 * One importer run: the `ingest_runs` row, the counts, and the read-compare-write of each event.
 *
 * Every importer under `importers/` did all of this itself — twenty-five copies of the run row's
 * lifecycle and of the upsert — and the copies drifted the way copies do. Only one of them kept a
 * category consolidation had filled in, so the other twenty-four wrote `anna` back over it every
 * night (see `keepKnownCategory`). What is left in an importer is what is actually about its
 * source: fetching, mapping, its venues, and any sweep it alone needs.
 *
 * `/datasamling` is built from the row this opens, so the rules here are the page's rules: a run
 * that rejected anything is `partial`, a run that threw is `failed` and keeps the counts it had,
 * and a dry run writes nothing at all — not even the row, which would otherwise sit at `running`
 * forever as an import that never finished and never happened.
 */

import { and, eq } from 'drizzle-orm';
import { keepKnownCategory } from './consolidate.ts';
import type { Db } from './db.ts';
import { applyGonePlan, goneCandidates, planRunSweep, type SweepMode } from './gone-upstream.ts';
import { events, ingestRuns, sources } from './schema.ts';
import { sameTrail } from './trail.ts';
import { sameWeeklyHours } from './weekly-hours.ts';

export type RunStatus = 'success' | 'partial' | 'failed';

export type RunCounts = {
	fetched: number;
	created: number;
	updated: number;
	unchanged: number;
	rejected: number;
};

/** What a run reports back to its CLI, and what its `ingest_runs` row holds. */
export type RunReport = RunCounts & {
	/** -1 for a dry run, which opens no row. */
	runId: number;
	status: Exclude<RunStatus, 'failed'>;
	durationMs: number;
	message: string | null;
};

export type RunOptions = {
	/** 'schedule' | 'manual' — how the run was kicked off. */
	trigger?: string;
	/** The commit that produced this run, so a behaviour change is traceable. */
	revision?: string | null;
	/** The `ingest_jobs` row this run belongs to, when `pnpm ingest:job` started it. */
	jobId?: number | null;
	dryRun?: boolean;
	now?: () => Date;
};

/** How many problems a run message carries. Enough to diagnose, not enough to bury the page. */
export const MAX_PROBLEMS = 10;

type EventInsert = typeof events.$inferInsert;
type EventRow = typeof events.$inferSelect;

/**
 * The columns a run compares before deciding a row changed.
 *
 * An importer writes some subset of these — a source with no pictures sends no poster fields,
 * and one whose descriptions are not worth keeping sends none — and only what it sends is
 * compared or written. A column it leaves out keeps whatever is there.
 */
const COMPARED = [
	'title',
	'description',
	'category',
	'startsAt',
	'endsAt',
	'venueId',
	'organizerId',
	'ctaUrl',
	'posterUrl',
	'posterSrcset',
	'posterRightsVerified',
	'status',
	'sourceUrl',
	'weeklyHours',
	'trail',
	'ageFrom',
	'ageTo'
] as const satisfies readonly (keyof EventInsert & keyof EventRow)[];

type Compared = (typeof COMPARED)[number];
type ComparedRow = Pick<EventRow, Compared>;

/** One imported event: its key, the three columns every row has, and whichever others it sends. */
export type EventValues = { sourceId: number; externalId: string } & Pick<
	EventInsert,
	'title' | 'startsAt' | 'category'
> &
	Partial<Pick<EventInsert, Exclude<Compared, 'title' | 'startsAt' | 'category'>>>;

const scalar = (a: unknown, b: unknown) => a === b;
const instant = (a: Date | null, b: Date | null | undefined) =>
	(a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Column by column, because an instant is not equal to itself by `===` and JSON is not either. */
const SAME: {
	[K in Compared]: (
		existing: ComparedRow[K],
		incoming: NonNullable<EventInsert[K]> | null
	) => boolean;
} = {
	title: scalar,
	description: scalar,
	category: scalar,
	startsAt: instant,
	endsAt: instant,
	venueId: scalar,
	organizerId: scalar,
	ctaUrl: scalar,
	posterUrl: scalar,
	posterSrcset: scalar,
	posterRightsVerified: scalar,
	status: scalar,
	sourceUrl: scalar,
	weeklyHours: sameWeeklyHours,
	trail: sameTrail,
	ageFrom: scalar,
	ageTo: scalar
};

function sameColumn<K extends Compared>(
	key: K,
	existing: ComparedRow,
	values: EventValues
): boolean {
	const incoming: EventInsert[K] = values[key];
	// Not sent is not changed: the importer does not write this column at all.
	if (incoming === undefined) return true;
	return SAME[key](existing[key], incoming);
}

/** Whether writing `values` over `existing` would change anything an importer writes. */
export function sameEvent(existing: ComparedRow, values: EventValues): boolean {
	return COMPARED.every((key) => sameColumn(key, existing, values));
}

/**
 * The run an importer's body is handed: counts, problems, and the one way to write an event.
 *
 * `problems` is a plain array on purpose. Most entries go through `note`, which caps them, but a
 * sweep's one-line summary at the end of a run is worth more than the eleventh rejection and may
 * be pushed directly.
 */
export class IngestRun {
	readonly counts: RunCounts = { fetched: 0, created: 0, updated: 0, unchanged: 0, rejected: 0 };
	readonly problems: string[] = [];

	readonly sourceId: number;
	readonly dryRun: boolean;
	readonly now: () => Date;
	readonly #db: Db;

	/**
	 * What this run vouches for when it ends — see `SweepMode`. `window` unless the importer says
	 * otherwise: an event a source deletes must leave the site with it, for every source, without
	 * each importer having to remember to ask.
	 */
	sweep: SweepMode = 'window';
	/** Every external id this run wrote or named, and the latest start among them. */
	readonly seen = new Set<string>();
	latestStart: Date | null = null;
	/** Rejections that named no id — any of these turns the sweep off for the run. */
	unidentified = 0;

	// Fields assigned by hand: Node's type stripping, which runs every importer, rejects
	// constructor parameter properties, and `pnpm verify` would never notice.
	constructor(db: Db, sourceId: number, dryRun: boolean, now: () => Date) {
		this.#db = db;
		this.sourceId = sourceId;
		this.dryRun = dryRun;
		this.now = now;
	}

	/** A problem worth reading on /datasamling, up to `MAX_PROBLEMS` of them. */
	note(problem: string): void {
		if (this.problems.length < MAX_PROBLEMS) this.problems.push(problem);
	}

	/**
	 * Something the source published that we could not take. This is what makes a run partial.
	 *
	 * Pass the row's external id where you have it: the source still lists that event, and the id
	 * is what keeps the sweep from marking it gone because we could not read it today.
	 */
	reject(problem: string, externalId?: string): void {
		this.counts.rejected += 1;
		this.note(problem);
		if (externalId) this.seen.add(externalId);
		else this.unidentified += 1;
	}

	/** A row the source still lists that we deliberately did not write. Not a rejection. */
	saw(externalId: string): void {
		this.seen.add(externalId);
	}

	#sighted(values: EventValues): void {
		this.seen.add(values.externalId);
		if (!this.latestStart || values.startsAt.getTime() > this.latestStart.getTime()) {
			this.latestStart = values.startsAt;
		}
	}

	/**
	 * Read before write, so a run reports what actually changed rather than marking every event
	 * "updated" daily and burying the one day a source really moved.
	 *
	 * Keyed on (source, external id). Never call this on a dry run: the importer stops before it
	 * resolves venues, which write too.
	 */
	async upsertEvent(values: EventValues): Promise<'created' | 'updated' | 'unchanged'> {
		if (this.dryRun) throw new Error('upsertEvent on a dry run — count it as created instead');
		this.#sighted(values);

		const [existing] = await this.#db
			.select()
			.from(events)
			.where(and(eq(events.sourceId, values.sourceId), eq(events.externalId, values.externalId)))
			.limit(1);

		if (!existing) {
			await this.#db.insert(events).values(values);
			this.counts.created += 1;
			return 'created';
		}

		/*
		 * A source that says "I don't know" does not get to overwrite a category consolidation
		 * filled in from a source that did. Without this the fill undoes itself every night — a row
		 * that flips twice a run and an `updated` count that is never true.
		 */
		const written: EventValues = {
			...values,
			category: keepKnownCategory(existing.category, values.category)
		};

		if (sameEvent(existing, written)) {
			this.counts.unchanged += 1;
			return 'unchanged';
		}

		await this.#db
			.update(events)
			.set({ ...written, updatedAt: this.now() })
			.where(eq(events.id, existing.id));
		this.counts.updated += 1;
		return 'updated';
	}
}

/**
 * Open a run for `sourceId`, hand it to `work`, and close it the way /datasamling expects.
 *
 * On success the row gets its counts, a status and the first problems; `sources.last_run_at` moves.
 * On a throw it is closed as `failed` with the counts so far and the error's message, and the
 * error is rethrown — the CLI decides what a failed source costs the others.
 */
export async function recordRun(
	db: Db,
	sourceId: number,
	options: RunOptions,
	work: (run: IngestRun) => Promise<void>
): Promise<RunReport> {
	const {
		trigger = 'manual',
		revision = null,
		jobId = null,
		dryRun = false,
		now = () => new Date()
	} = options;
	const startedAt = now();

	let runId = -1;
	if (!dryRun) {
		const [row] = await db
			.insert(ingestRuns)
			.values({ sourceId, jobId, startedAt, status: 'running', trigger, revision })
			.returning({ id: ingestRuns.id });
		if (!row) throw new Error('could not open an ingest run');
		runId = row.id;
	}

	const run = new IngestRun(db, sourceId, dryRun, now);

	try {
		await work(run);
		if (!dryRun) await sweepGoneUpstream(db, run);

		const status = run.counts.rejected > 0 ? 'partial' : 'success';
		const finishedAt = now();
		const durationMs = finishedAt.getTime() - startedAt.getTime();
		const message = run.problems.length ? run.problems.join('; ').slice(0, 2000) : null;

		if (!dryRun) {
			await db
				.update(ingestRuns)
				.set({ finishedAt, status, ...run.counts, durationMs, message })
				.where(eq(ingestRuns.id, runId));
			await db.update(sources).set({ lastRunAt: finishedAt }).where(eq(sources.id, sourceId));
		}

		return { runId, status, ...run.counts, durationMs, message };
	} catch (error) {
		// Nothing to close if the run was never opened.
		if (dryRun) throw error;
		const finishedAt = now();
		const message = error instanceof Error ? error.message : String(error);
		await db
			.update(ingestRuns)
			.set({
				finishedAt,
				status: 'failed',
				...run.counts,
				durationMs: finishedAt.getTime() - startedAt.getTime(),
				message: message.slice(0, 2000)
			})
			.where(eq(ingestRuns.id, runId));
		throw error;
	}
}

/**
 * After a run that finished: mark this source's events it no longer lists, and clear the mark on
 * any that came back. Only after success — a run that threw saw an arbitrary part of the source —
 * and reported as a note, because it is what we changed, not what the source published.
 */
async function sweepGoneUpstream(db: Db, run: IngestRun): Promise<void> {
	if (run.sweep === 'self' || run.sweep === 'off') return;
	const now = run.now();
	const { plan, skipped } = planRunSweep({
		mode: run.sweep,
		seen: run.seen,
		latestStart: run.latestStart,
		unidentified: run.unidentified,
		candidates: await goneCandidates(db, run.sourceId, now),
		now
	});
	if (skipped) run.note(skipped);
	if (!plan) return;
	const { marked, restored } = await applyGonePlan(db, plan, now);
	if (marked > 0) run.note(`${marked} no longer listed upstream, taken off the site`);
	if (restored > 0) run.note(`${restored} listed again upstream, put back`);
}

/** A source's own row, as an importer registers it on every run. */
export type SourceRegistration = Pick<
	typeof sources.$inferInsert,
	| 'slug'
	| 'name'
	| 'url'
	| 'endpoint'
	| 'kind'
	| 'note'
	| 'scheduleCron'
	| 'iconUrl'
	| 'trusted'
	| 'region'
	| 'attribution'
>;

/**
 * Insert the source, or bring an existing row up to date with the importer's config.
 *
 * Slug, region and attribution are written once and then left to whoever edits them. Everything
 * else follows the code, including `active: true` — a source can arrive here already registered
 * as a `link` row, which the directory creates inactive because nothing was collecting it, and
 * graduating it without flipping that leaves a source publishing events while excluded from every
 * count that means "places this list comes from".
 */
export async function registerSource(db: Db, source: SourceRegistration) {
	const { slug, region, attribution, ...config } = source;
	const shared = { ...config, active: true };
	const [row] = await db
		.insert(sources)
		.values({ slug, region, attribution, ...shared })
		.onConflictDoUpdate({ target: sources.slug, set: shared })
		.returning();
	if (!row) throw new Error(`could not register the source ${slug}`);
	return row;
}

/** One source's line in a CLI's output: its run, or the failure that stopped it. */
export type IngestResult = Omit<RunReport, 'status'> & { slug: string; status: RunStatus };

/** A source that threw before or during its run. Its own `ingest_runs` row says so already. */
export function failedResult(slug: string, error: unknown): IngestResult {
	return {
		runId: -1,
		slug,
		status: 'failed',
		fetched: 0,
		created: 0,
		updated: 0,
		unchanged: 0,
		rejected: 0,
		durationMs: 0,
		message: error instanceof Error ? error.message : String(error)
	};
}

/**
 * Every configured instance, one at a time. One failing site must not stop the others — they are
 * independent sources that happen to share a parser, so a failure is recorded against that source
 * alone.
 */
export async function ingestEach<T extends { slug: string }>(
	items: readonly T[],
	ingestOne: (item: T) => Promise<IngestResult>
): Promise<IngestResult[]> {
	const results: IngestResult[] = [];
	for (const item of items) {
		try {
			results.push(await ingestOne(item));
		} catch (error) {
			results.push(failedResult(item.slug, error));
		}
	}
	return results;
}
