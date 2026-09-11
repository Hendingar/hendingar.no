import { and, eq } from 'drizzle-orm';
import type { Db } from '@hendingar/core/db';
import { events, ingestRuns, sources, venues, type NewEvent } from '@hendingar/core/schema';
import type { SourceConfig, SourceFacts, VenueUpsert } from './contract.ts';

/**
 * Every database call the runner makes, named after what it does.
 *
 * This is a seam, and it exists for one reason: **the orchestration layer had zero tests in all
 * fifteen importers**, and it could not have any, because each `ingest.ts` called `createDb` itself
 * and then talked to drizzle inline. Faking drizzle's `Db` needs `as unknown as Db`, which CLAUDE.md
 * rule 4 calls a red flag rather than a fix. Nine importers shipped a change-detection bug into that
 * untested layer, which is a fair summary of the cost.
 *
 * A plain object satisfies this type, so `test/ingest.test.ts` records calls with no cast anywhere.
 *
 * It is deliberately not a repository abstraction. Each method is one statement against one table,
 * so `grep upsertVenue` still lands on the SQL — rule 5's objection to indirection is that it
 * defeats grep, and a method named after its statement does not.
 */

export type SourceRow = typeof sources.$inferSelect;
export type EventRow = typeof events.$inferSelect;

export type RunClosing = {
	finishedAt: Date;
	status: 'success' | 'partial' | 'failed';
	fetched: number;
	created: number;
	updated: number;
	unchanged: number;
	rejected: number;
	durationMs: number;
	message: string | null;
};

export type EventStore = {
	upsertSource(config: SourceConfig, facts: SourceFacts): Promise<SourceRow>;
	openRun(input: {
		sourceId: number;
		startedAt: Date;
		trigger: string;
		revision: string | null;
	}): Promise<number>;
	closeRun(runId: number, closing: RunClosing): Promise<void>;
	touchSource(sourceId: number, at: Date): Promise<void>;
	upsertVenue(venue: VenueUpsert): Promise<number | null>;
	findEvent(sourceId: number, externalId: string): Promise<EventRow | null>;
	insertEvent(values: NewEvent): Promise<void>;
	updateEvent(id: number, values: NewEvent, updatedAt: Date): Promise<void>;
};

/** The real one. Every statement here was written out once per importer before this. */
export function drizzleStore(db: Db): EventStore {
	return {
		async upsertSource(config, facts) {
			/*
			 * One object, spread into both halves.
			 *
			 * A field written only on insert can never be corrected on a row that already exists, and
			 * `importers/detskjer` proved it by writing the list twice and leaving `active` and `note`
			 * out of both. `slug`, `region` and `attribution` stay insert-only: they are the identity
			 * and the credit, not settings to converge on.
			 */
			const shared = {
				name: config.name,
				url: config.url,
				endpoint: facts.endpoint,
				note: facts.note,
				kind: facts.kind,
				/*
				 * Explicitly active.
				 *
				 * A source can arrive here already existing as a `link` row, which the directory
				 * registers with `active: false` because nothing was collecting it. Graduating it
				 * without flipping this back leaves a source that publishes events while being
				 * excluded from every count that means "places this list comes from" — visible on the
				 * page, invisible in the numbers.
				 */
				active: true,
				scheduleCron: config.scheduleCron,
				iconUrl: config.iconUrl,
				trusted: config.trusted
			};
			const [row] = await db
				.insert(sources)
				.values({
					slug: config.slug,
					region: config.region,
					attribution: config.attribution,
					...shared
				})
				.onConflictDoUpdate({ target: sources.slug, set: shared })
				.returning();
			if (!row) throw new Error(`could not register the source ${config.slug}`);
			return row;
		},

		async openRun({ sourceId, startedAt, trigger, revision }) {
			const [run] = await db
				.insert(ingestRuns)
				.values({ sourceId, startedAt, status: 'running', trigger, revision })
				.returning({ id: ingestRuns.id });
			if (!run) throw new Error('could not open an ingest run');
			return run.id;
		},

		async closeRun(runId, closing) {
			await db.update(ingestRuns).set(closing).where(eq(ingestRuns.id, runId));
		},

		async touchSource(sourceId, at) {
			await db.update(sources).set({ lastRunAt: at }).where(eq(sources.id, sourceId));
		},

		async upsertVenue(venue) {
			const [row] = await db
				.insert(venues)
				.values({
					name: venue.name,
					slug: venue.slug,
					/*
					 * Never guessed from the source. `city` is empty or wrong on most of them —
					 * allevents.in files a hall in Sagvåg under "Ølen" — and a postal town is not a
					 * municipality: Leirvik is in Stord, Svortland is in Bømlo. Left for the geocoder,
					 * which `geocodeStatus: 'pending'` is what flags.
					 */
					municipality: venue.municipality ?? null,
					address: venue.address ?? null,
					postalCode: venue.postalCode ?? null,
					timezone: venue.timezone,
					geocodeStatus: 'pending'
				})
				.onConflictDoUpdate({
					target: venues.slug,
					set: {
						name: venue.name,
						// Only ever filled in, never blanked — see VenueUpsert.
						...(venue.address ? { address: venue.address } : {}),
						...(venue.postalCode ? { postalCode: venue.postalCode } : {}),
						...(venue.municipality ? { municipality: venue.municipality } : {})
					}
				})
				.returning({ id: venues.id });
			return row?.id ?? null;
		},

		async findEvent(sourceId, externalId) {
			/*
			 * The whole row, not a projection.
			 *
			 * Building a `select({...})` from the keys of `values` is the obvious implementation and
			 * needs a cast to satisfy drizzle's typing. Reading the row whole keeps the comparison
			 * honest — see `isUnchanged` — and a few unread columns per event is nothing next to a
			 * runner that cannot forget one.
			 */
			const [row] = await db
				.select()
				.from(events)
				.where(and(eq(events.sourceId, sourceId), eq(events.externalId, externalId)))
				.limit(1);
			return row ?? null;
		},

		async insertEvent(values) {
			await db.insert(events).values(values);
		},

		async updateEvent(id, values, updatedAt) {
			await db
				.update(events)
				.set({ ...values, updatedAt })
				.where(eq(events.id, id));
		}
	};
}
