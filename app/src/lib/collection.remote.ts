import { query } from '$app/server';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { events, ingestRuns, sources } from '@hendingar/core/schema';
import { db } from './server/db';

/**
 * Everything /datasamling shows. Read-only, no arguments — the page is a public status board.
 *
 * The numbers come from `ingest_runs`, not from a config file, so the page cannot claim a source
 * is being collected unless a run actually happened.
 */
export const listCollection = query(async () => {
	const database = db();
	const now = new Date();

	const rows = await database
		.select({
			id: sources.id,
			slug: sources.slug,
			name: sources.name,
			url: sources.url,
			endpoint: sources.endpoint,
			region: sources.region,
			kind: sources.kind,
			scheduleCron: sources.scheduleCron,
			trusted: sources.trusted,
			active: sources.active,
			attribution: sources.attribution,
			lastRunAt: sources.lastRunAt
		})
		.from(sources)
		.orderBy(sources.name);

	const collected = await Promise.all(
		rows.map(async (source) => {
			const [totals] = await database
				.select({ total: count() })
				.from(events)
				.where(eq(events.sourceId, source.id));

			const [upcoming] = await database
				.select({ total: count() })
				.from(events)
				.where(
					and(
						eq(events.sourceId, source.id),
						eq(events.status, 'published'),
						gte(events.startsAt, now)
					)
				);

			// Enough history to show a strip of recent runs, not so much that the page gets heavy.
			const runs = await database
				.select({
					id: ingestRuns.id,
					startedAt: ingestRuns.startedAt,
					finishedAt: ingestRuns.finishedAt,
					status: ingestRuns.status,
					trigger: ingestRuns.trigger,
					fetched: ingestRuns.fetched,
					created: ingestRuns.created,
					updated: ingestRuns.updated,
					unchanged: ingestRuns.unchanged,
					rejected: ingestRuns.rejected,
					durationMs: ingestRuns.durationMs,
					message: ingestRuns.message
				})
				.from(ingestRuns)
				.where(eq(ingestRuns.sourceId, source.id))
				.orderBy(desc(ingestRuns.startedAt))
				.limit(14);

			return {
				...source,
				eventsTotal: totals?.total ?? 0,
				eventsUpcoming: upcoming?.total ?? 0,
				runs
			};
		})
	);

	// Events with no source are human submissions — worth showing, since "anyone can submit" is a
	// stated feature and the page would otherwise imply importers are the only way in.
	const [submitted] = await database
		.select({ total: count() })
		.from(events)
		.where(sql`${events.sourceId} is null`);

	return {
		generatedAt: now,
		sources: collected,
		submittedCount: submitted?.total ?? 0
	};
});

export type Collection = Awaited<ReturnType<typeof listCollection>>;
export type CollectedSource = Collection['sources'][number];
export type IngestRunSummary = CollectedSource['runs'][number];
