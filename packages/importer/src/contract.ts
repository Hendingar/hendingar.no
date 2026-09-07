import type { NewEvent } from '@hendingar/core/schema';
import type { Db } from '@hendingar/core/db';
import type { MapFailure, MappedEventBase } from './mapped.ts';
import type { EventRow, EventStore, SourceRow } from './store.ts';

/**
 * What an importer has to say for itself, and nothing more.
 *
 * Separated from `ingest.ts` so `store.ts` can name these types without importing the runner, which
 * imports the store. One direction only: contract ← store ← ingest.
 */

export type IngestStatus = 'success' | 'partial' | 'failed';

export type IngestResult = {
	runId: number;
	slug: string;
	status: IngestStatus;
	fetched: number;
	created: number;
	updated: number;
	unchanged: number;
	rejected: number;
	durationMs: number;
	message: string | null;
};

/**
 * The fields every importer's config array carries, whatever it calls its entries.
 *
 * They are called `INSTANCES`, `ORGANISERS`, `SITES`, `TEAMS`, `CAMPUSES` and `ASSOCIATIONS` across
 * the fifteen, and the entries `instance`, `organiser`, `site`, `team`, `campus`, `association`.
 * The names stay — they are what each source's own vocabulary calls the thing — but the shape is
 * this, so the runner can register any of them.
 */
export type SourceConfig = {
	slug: string;
	name: string;
	url: string;
	region: string;
	attribution: string;
	timezone: string;
	scheduleCron: string;
	iconUrl: string | null;
	trusted: boolean;
};

/** What only the importer can say about how its source is read. Rendered on /datasamling. */
export type SourceFacts = {
	kind: 'json-api' | 'html' | 'feed';
	/** The URL actually fetched, which is often not the page a human visits. */
	endpoint: string;
	/** Nynorsk, one or two sentences, describing how this source is collected. */
	note: string;
};

/**
 * The venue to upsert for an event, or null to leave `venueId` unset.
 *
 * `address`, `postalCode` and `municipality` are **only ever filled in, never blanked** — the rule
 * the address-writing importers stated explicitly and which `importers/billetto` broke by writing
 * `municipality` unconditionally, overwriting a good value with null on any later run that omitted
 * one. Enforced in `drizzleStore.upsertVenue`, so no importer can get it wrong again.
 */
export type VenueUpsert = {
	name: string;
	slug: string;
	timezone: string;
	address?: string | null;
	postalCode?: string | null;
	municipality?: string | null;
};

/**
 * What `collect` gets besides its config.
 *
 * `startedAt` rather than a live clock, because some sources take the time as a *request parameter*:
 * `importers/checkin` filters on `EVENT_ENDS_AT >= <epoch seconds>`, and `importers/hvl` derives the
 * months to walk from it. Handing them the run's own instant keeps that hermetic — a test injects
 * `now` and the request is then fixed (CLAUDE.md rule 6).
 */
export type CollectContext = {
	startedAt: Date;
};

export type ValuesContext<TMapped> = {
	mapped: TMapped;
	source: SourceRow;
	venueId: number | null;
	/**
	 * The stored row, when there is one — available *before* `values` is built.
	 *
	 * `importers/allevents` needs this: `preferDescription` refuses to replace a description it
	 * already holds with a degraded copy (a detail page that 500'd, or the stripped template
	 * allevents.in serves at random). Every other importer ignores the field.
	 */
	existing: EventRow | null;
};

export type RunCounts = {
	fetched: number;
	created: number;
	updated: number;
	unchanged: number;
	rejected: number;
};

export type Importer<TConfig extends SourceConfig, TMapped extends MappedEventBase> = {
	/** How this source is read. Merged into the `sources` row on every run. */
	facts: (config: TConfig) => SourceFacts;
	/**
	 * Fetch, parse, validate and map — the whole per-source pipeline, returning mapped events and
	 * rejections in one sequence.
	 *
	 * **This may and should throw.** "The source went quiet" reported as a successful import of zero
	 * events is the one outcome /datasamling cannot show honestly (ADR 0004), so a moved programme
	 * block, a failed schema parse or an empty feed belongs here as an exception, not as a count of
	 * nought.
	 */
	collect: (config: TConfig, context: CollectContext) => Promise<Iterable<TMapped | MapFailure>>;
	/** The `events` columns to write. The change comparison is derived from whatever this returns. */
	values: (context: ValuesContext<TMapped>) => NewEvent;
	/** The venue for an event. Omit for the common case, which reads the base fields. */
	venue?: (mapped: TMapped, config: TConfig) => VenueUpsert | null;
	/** Extra lines for the run message, ahead of the per-event problems. */
	notes?: (counts: RunCounts) => readonly (string | null)[];
	/** Runs before `collect`, for cleanup a source needs (importers/mec sweeps superseded ids). */
	beforeRun?: (db: Db, source: SourceRow) => Promise<readonly string[]>;
	/**
	 * What a repeated `externalId` within one run means.
	 *
	 * `skip` for almost everyone — the same event legitimately appears in two weekly windows.
	 * `reject` for `importers/tec`, where a repeat means the key is wrong and must be visible.
	 */
	onDuplicate?: 'skip' | 'reject';
};

export type RunOptions = {
	trigger?: string;
	revision?: string | null;
	/** Map and count, write nothing but the `sources` row. */
	dryRun?: boolean;
	now?: () => Date;
	/**
	 * The database, injected.
	 *
	 * Importers never pass this — `runIngest` builds one from the connection string. It exists so the
	 * orchestration can be tested at all: a plain object satisfies `EventStore`, which is why
	 * `test/ingest.test.ts` needs no cast to fake a database (CLAUDE.md rules 4 and 6).
	 */
	store?: EventStore;
};
