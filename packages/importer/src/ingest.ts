import { createDb } from '@hendingar/core/db';
import { isFailure, type MappedEventBase } from './mapped.ts';
import { drizzleStore, type EventStore } from './store.ts';
import type {
	Importer,
	IngestResult,
	IngestStatus,
	RunOptions,
	SourceConfig,
	VenueUpsert
} from './contract.ts';

/**
 * The part of an importer that was the same fifteen times.
 *
 * Measured before extracting: `ingest.ts` was 5,182 lines across fifteen importers with ~79% of the
 * executable code identical, and the `ingest_runs` lifecycle — open, close, catch — was byte-for-byte
 * the same in every one. What differs per source is `api.ts` and `map.ts`, which stay where they are:
 * that is where the load-bearing knowledge lives (MEC applies its own offset twice, allevents'
 * "epoch" was a wall clock, fotball needs RFC 5545 unfolding or a home match becomes an away one).
 *
 * ## Why this exists, rather than "it was repetitive"
 *
 * The copies drifted, and the drift was a bug. Nine of the fifteen wrote `sourceUrl` into the update
 * and left it out of the comparison, so a source that moved an event's canonical URL was reported
 * `unchanged` and the stale URL was never written — the exact failure the "read before write" comment
 * above the block claimed to prevent. PR #96 fixed the nine instances. This removes the mechanism:
 * **the comparison is derived from the keys of `values`** and cannot fall behind what is written.
 *
 * ## What it deliberately does not own
 *
 * No shared process and no central registration. Each importer keeps its own `cli.ts`, its own
 * process and its own `ingest_runs` row, because `--no-bail` exists to stop one rate-limited upstream
 * taking the healthy sources down with it, and because a package under `importers/` is still the
 * whole registration.
 */

/** How many problem lines a run records before it stops collecting them. */
const PROBLEM_LIMIT = 10;
/** `ingest_runs.message` is read on a status board, not in a log aggregator. */
const MESSAGE_LIMIT = 2000;

/**
 * Equality for one column, as the database will store it.
 *
 * Dates are compared as instants: `startsAt` comes back from Postgres as a `Date` and is written as
 * one, and `===` on two different `Date` objects for the same moment is always false. `null` and
 * `undefined` are the same absence — an importer that omits a key and one that sets it to null both
 * mean "nothing stored".
 */
function sameValue(stored: unknown, incoming: unknown): boolean {
	if (stored instanceof Date && incoming instanceof Date) {
		return stored.getTime() === incoming.getTime();
	}
	if (stored instanceof Date || incoming instanceof Date) return false;
	return (stored ?? null) === (incoming ?? null);
}

/**
 * Whether the stored row already says everything `values` is about to write.
 *
 * **Derived from `values`, which is the whole reason this function exists.** Every importer used to
 * hand-write a `same` chain next to a hand-written `select` projection, and keeping two lists in step
 * with a third — the `values` object — is what nine of them failed at. Iterating the keys actually
 * being written cannot fall behind them.
 *
 * `sourceId` and `externalId` are skipped because they are the lookup: the row was found *by* them,
 * so they are equal by construction and comparing them could only ever be noise.
 */
export function isUnchanged(
	stored: Record<string, unknown>,
	incoming: Record<string, unknown>
): boolean {
	for (const [column, value] of Object.entries(incoming)) {
		if (column === 'sourceId' || column === 'externalId') continue;
		if (!sameValue(stored[column], value)) return false;
	}
	return true;
}

/** The common case: a venue named by the mapped event, in the config's timezone. */
function defaultVenue<TMapped extends MappedEventBase>(
	mapped: TMapped,
	config: SourceConfig
): VenueUpsert | null {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	return { name: mapped.venueName, slug: mapped.venueSlug, timezone: config.timezone };
}

/**
 * One source, one `ingest_runs` row, whatever happens.
 *
 * The row is inserted as `running` and closed on both the success and the failure path. A dry run
 * opens none: it used to leave one permanently `running`, so /datasamling showed an import that never
 * finished and never happened — a flag promising to write nothing must not write the one row the
 * status board is built from.
 */
export async function runIngest<TConfig extends SourceConfig, TMapped extends MappedEventBase>(
	connectionString: string,
	config: TConfig,
	importer: Importer<TConfig, TMapped>,
	options: RunOptions = {}
): Promise<IngestResult> {
	const { trigger = 'manual', revision = null, dryRun = false, now = () => new Date() } = options;
	const db = createDb(connectionString);
	const store: EventStore = options.store ?? drizzleStore(db);

	const startedAt = now();
	const source = await store.upsertSource(config, importer.facts(config));

	const runId = dryRun
		? -1
		: await store.openRun({ sourceId: source.id, startedAt, trigger, revision });

	let fetched = 0;
	let created = 0;
	let updated = 0;
	let unchanged = 0;
	let rejected = 0;
	const problems: string[] = [];
	const note = (line: string) => {
		if (problems.length < PROBLEM_LIMIT) problems.push(line);
	};
	const elapsed = (at: Date) => at.getTime() - startedAt.getTime();

	try {
		if (importer.beforeRun && !dryRun) {
			for (const line of await importer.beforeRun(db, source)) note(line);
		}

		const seen = new Set<string>();

		for (const mapped of await importer.collect(config, { startedAt })) {
			fetched += 1;

			if (isFailure(mapped)) {
				rejected += 1;
				note(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}

			if (seen.has(mapped.externalId)) {
				if (importer.onDuplicate === 'reject') {
					rejected += 1;
					note(`${mapped.externalId}: repeated in one run — the external id is not unique`);
				}
				continue;
			}
			seen.add(mapped.externalId);

			if (dryRun) {
				created += 1;
				continue;
			}

			const venue = (importer.venue ?? defaultVenue)(mapped, config);
			const venueId = venue ? await store.upsertVenue(venue) : null;

			/*
			 * Read before write, so a run reports what actually changed rather than marking every
			 * event "updated" daily and burying the one day a source really moved.
			 *
			 * Read *before* `values` is built, not after, so `values` can see the stored row —
			 * allevents needs that, and every other importer simply ignores the argument.
			 */
			const existing = await store.findEvent(source.id, mapped.externalId);
			const values = importer.values({ mapped, source, venueId, existing });

			if (!existing) {
				await store.insertEvent(values);
				created += 1;
				continue;
			}

			if (isUnchanged(existing, values)) {
				unchanged += 1;
				continue;
			}

			await store.updateEvent(existing.id, values, now());
			updated += 1;
		}

		const status: IngestStatus = rejected > 0 ? 'partial' : 'success';
		const finishedAt = now();
		const extra = importer.notes?.({ fetched, created, updated, unchanged, rejected }) ?? [];
		const lines = [...extra, ...problems].filter((line): line is string => Boolean(line));
		const message = lines.length ? lines.join('; ').slice(0, MESSAGE_LIMIT) : null;
		const counts = { fetched, created, updated, unchanged, rejected };

		if (!dryRun) {
			await store.closeRun(runId, {
				finishedAt,
				status,
				...counts,
				durationMs: elapsed(finishedAt),
				message
			});
			await store.touchSource(source.id, finishedAt);
		}

		return {
			runId,
			slug: config.slug,
			status,
			...counts,
			durationMs: elapsed(finishedAt),
			message
		};
	} catch (error) {
		const finishedAt = now();
		const message = error instanceof Error ? error.message : String(error);
		// Nothing to close if the run was never opened.
		if (dryRun) throw error;
		await store.closeRun(runId, {
			finishedAt,
			status: 'failed',
			fetched,
			created,
			updated,
			unchanged,
			rejected,
			durationMs: elapsed(finishedAt),
			message: message.slice(0, MESSAGE_LIMIT)
		});
		throw error;
	}
}

/**
 * Every configured source for one importer.
 *
 * One failing entry must not stop the others: they are independent sources that happen to share a
 * parser, so a failure is recorded against that source alone and returned as its own row. Same
 * reason `pnpm ingest` runs with `--no-bail`.
 */
export async function runAll<TConfig extends SourceConfig, TMapped extends MappedEventBase>(
	connectionString: string,
	configs: readonly TConfig[],
	importer: Importer<TConfig, TMapped>,
	options: RunOptions = {}
): Promise<IngestResult[]> {
	const results: IngestResult[] = [];
	for (const config of configs) {
		try {
			results.push(await runIngest(connectionString, config, importer, options));
		} catch (error) {
			results.push({
				runId: -1,
				slug: config.slug,
				status: 'failed',
				fetched: 0,
				created: 0,
				updated: 0,
				unchanged: 0,
				rejected: 0,
				durationMs: 0,
				message: error instanceof Error ? error.message : String(error)
			});
		}
	}
	return results;
}
