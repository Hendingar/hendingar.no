import { query } from '$app/server';
import { and, count, desc, eq, gte, or, sql } from 'drizzle-orm';
import {
	curatorPicks,
	events,
	ingestRuns,
	sources,
	venues,
	verifications
} from '@hendingar/core/schema';
import { publicSubmissionTitle } from '@hendingar/core/verification';
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
			note: sources.note,
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

			/*
			 * "Framover" means not finished yet, which is the rule the listing uses.
			 *
			 * On `startsAt` alone a festival that opened yesterday and runs all week counts as
			 * past, so a source could report 0 framover while /hendingar?kjelde= still listed it.
			 * The row now gates its link to that listing on this number, so the two definitions
			 * have to be the same one — see listEvents in events.remote.ts.
			 */
			const [upcoming] = await database
				.select({ total: count() })
				.from(events)
				.where(
					and(
						eq(events.sourceId, source.id),
						eq(events.status, 'published'),
						or(gte(events.startsAt, now), gte(events.endsAt, now))
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
		// Five. The log is a "what just happened" signal on a status board, not an archive: a long
		// scroll of submissions pushes the source rows — the other half of the page — below the fold.
		.limit(5);

	const [pending] = await database
		.select({ total: count() })
		.from(events)
		.where(and(sql`${events.sourceId} is null`, eq(events.status, 'pending')));

	/*
	 * How many submitted events `/hendingar?kjelde=innsendt` actually holds.
	 *
	 * Not `submittedCount`, which counts everything ever sent in — including the ones that were
	 * declined and the ones whose evening has passed. The link is offered only when there is
	 * something behind it, because that filter degrades badly when there is not: `/hendingar`
	 * validates `kjelde` against the sources it can offer, and an unknown slug is dropped rather
	 * than refused, so a link to an empty "innsendt" quietly shows the whole listing instead.
	 *
	 * The conditions are `listSourceCounts`'s submitted branch, exactly: published, canonical,
	 * dated, still to come, no source row, and not an import that happens to lack one.
	 */
	const [submittedLive] = await database
		.select({ total: count() })
		.from(events)
		.where(
			and(
				eq(events.status, 'published'),
				sql`${events.duplicateOfId} is null`,
				eq(events.kind, 'dated'),
				sql`${events.sourceId} is null`,
				sql`${events.submissionMethod} <> 'import'`,
				or(gte(events.startsAt, now), gte(events.endsAt, now))
			)
		);

	/*
	 * What the checks actually decided, across every submission we have ever had.
	 *
	 * The page could already say exactly how each source is collected and nothing whatever about
	 * the half of the pipeline that judges. That is the wrong half to be quiet about: the README
	 * promises the agents' reasoning is auditable, and "auditable" has meant "readable one
	 * submission at a time" — you could see why *your* event was declined and never whether the
	 * checks are any good.
	 *
	 * Both ADR 0017 and ADR 0018 name a falsification condition that needs numbers nobody was
	 * keeping. This is the shape of that: per check, what it decided and how sure it was, and — for
	 * the two that call a model — what the calls cost.
	 *
	 * `duration_ms` and `tokens` are averaged over the rows that have them rather than over all of
	 * them. They are null for every rule check and for every check a rule refused before the model
	 * was reached, and counting those as zero would flatter the average with calls that never
	 * happened.
	 */
	const checkStats = await database
		.select({
			check: verifications.check,
			total: count(),
			passed: sql<number>`count(*) filter (where ${verifications.verdict} = 'pass')::int`,
			uncertain: sql<number>`count(*) filter (where ${verifications.verdict} = 'uncertain')::int`,
			failed: sql<number>`count(*) filter (where ${verifications.verdict} = 'fail')::int`,
			/** Of the rows that carry one — see above. */
			meanConfidence: sql<number | null>`round(avg(${verifications.confidence}))::int`,
			/** Null for every rule check, which is how the page tells the two kinds apart. */
			meanDurationMs: sql<number | null>`round(avg(${verifications.durationMs}))::int`,
			totalTokens: sql<number | null>`sum(${verifications.tokens})::int`,
			calls: sql<number>`count(${verifications.durationMs})::int`
		})
		.from(verifications)
		.groupBy(verifications.check);

	/*
	 * The kurator's record: how often it stood behind anything at all.
	 *
	 * Three is the ceiling, never a target — ADR 0018 says nothing is back-filled to reach it, and
	 * an empty night is an honest answer. So the number worth publishing is how many nights it ran
	 * and how many picks it made, not an average dressed up as a score. No hearts, no views, no
	 * measure of attention: those never reach the selection and they do not reach this either.
	 */
	const [curator] = await database
		.select({
			nights: sql<number>`count(distinct ${curatorPicks.forDate})::int`,
			picks: count(),
			latest: sql<string | null>`max(${curatorPicks.forDate})`
		})
		.from(curatorPicks);

	return {
		generatedAt: now,
		sources: collected,
		submittedCount: submitted?.total ?? 0,
		/** Published, upcoming, and reachable at `/hendingar?kjelde=innsendt`. */
		submittedLiveCount: submittedLive?.total ?? 0,
		pendingCount: pending?.total ?? 0,
		submissions: submissions.map((row) => ({
			...row,
			title: publicSubmissionTitle(row.status, row.title)
		})),
		/** Per check, what it has decided — and for the two that call a model, what that cost. */
		checks: checkStats,
		curator: curator ?? { nights: 0, picks: 0, latest: null }
	};
});

export type Collection = Awaited<ReturnType<typeof listCollection>>;
export type SubmissionLogRow = Collection['submissions'][number];
export type CollectedSource = Collection['sources'][number];
export type CheckStats = Collection['checks'][number];
export type IngestRunSummary = CollectedSource['runs'][number];
