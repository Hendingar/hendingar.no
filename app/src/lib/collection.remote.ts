import { query } from '$app/server';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
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
			iconUrl: sources.iconUrl,
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

	/*
	 * The submission log.
	 *
	 * /datasamling could account for every imported event and none of the submitted ones, so the
	 * half of the pipeline with a person in it was invisible. A count is not enough: the point of
	 * publishing verification reasoning is that someone can read it, and that means a list.
	 *
	 * Titles are shown for pending and published rows but withheld for rejected ones — a rejected
	 * submission is retained as evidence (see submit.remote.ts), and republishing the text of
	 * something we judged to be spam or abuse would defeat rejecting it.
	 */
	const submissions = await database
		.select({
			id: events.id,
			title: events.title,
			status: events.status,
			method: events.submissionMethod,
			createdAt: events.createdAt,
			startsAt: events.startsAt,
			venueName: venues.name,
			notes: events.verificationNotes
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(sql`${events.sourceId} is null`)
		.orderBy(desc(events.createdAt))
		.limit(25);

	const [pending] = await database
		.select({ total: count() })
		.from(events)
		.where(and(sql`${events.sourceId} is null`, eq(events.status, 'pending')));

	return {
		generatedAt: now,
		sources: collected,
		submittedCount: submitted?.total ?? 0,
		pendingCount: pending?.total ?? 0,
		submissions: submissions.map((row) => ({
			...row,
			title: row.status === 'rejected' ? null : row.title
		}))
	};
});

export type Collection = Awaited<ReturnType<typeof listCollection>>;
export type SubmissionLogRow = Collection['submissions'][number];
export type CollectedSource = Collection['sources'][number];
export type IngestRunSummary = CollectedSource['runs'][number];
