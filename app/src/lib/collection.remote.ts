import { query } from '$app/server';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import {
	curatorPicks,
	events,
	ingestJobs,
	ingestRuns,
	sources,
	venues,
	verifications
} from '@hendingar/core/schema';
import { publicSubmissionTitle } from '@hendingar/core/verification';
import { db } from './server/db';
import {
	fromSourceGroup,
	listed,
	notOver,
	submittedByHand,
	weeklyListed
} from './server/listing.ts';

/**
 * Everything /datasamling shows. Read-only, no arguments — the page is a public list of sources.
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
			 * have to be the same one: the listing's own clauses, matched over the whole duplicate
			 * group exactly as listEvents matches `?kjelde=`.
			 */
			const [upcoming] = await database
				.select({ total: count() })
				.from(events)
				.where(and(listed, notOver(now), fromSourceGroup(source.slug)));

			/*
			 * Weekly activities, counted apart. They are not "hendingar framover" — they have no
			 * date to be ahead of — but a source whose whole calendar is a timetable is not empty
			 * either, and the row said it was. Same clauses as `/alltid-ope`, same source grouping.
			 */
			const [weekly] = await database
				.select({ total: count() })
				.from(events)
				.where(and(weeklyListed(now), fromSourceGroup(source.slug)));

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
				activitiesWeekly: weekly?.total ?? 0,
				runs
			};
		})
	);

	// Events with no source are human submissions. Counted here only for the link to
	// /innsendingar, which is where they are listed and where the checks are accounted for.
	const [submitted] = await database
		.select({ total: count() })
		.from(events)
		.where(sql`${events.sourceId} is null`);

	const [pending] = await database
		.select({ total: count() })
		.from(events)
		.where(and(sql`${events.sourceId} is null`, eq(events.status, 'pending')));

	/*
	 * The night as a whole: did the collection happen, and how did it go. The per-source rows
	 * above cannot say that a night never ran, and that is the failure that matters most.
	 */
	const [latestJob] = await database
		.select({
			id: ingestJobs.id,
			startedAt: ingestJobs.startedAt,
			finishedAt: ingestJobs.finishedAt,
			status: ingestJobs.status,
			sourcesRun: ingestJobs.sourcesRun,
			sourcesFailed: ingestJobs.sourcesFailed,
			durationMs: ingestJobs.durationMs
		})
		.from(ingestJobs)
		.orderBy(desc(ingestJobs.startedAt))
		.limit(1);

	// Named from the runs rather than parsed out of the message, so each can link to its row.
	const failedInJob = latestJob
		? await database
				.select({ slug: sources.slug, name: sources.name })
				.from(ingestRuns)
				.innerJoin(sources, eq(ingestRuns.sourceId, sources.id))
				.where(
					and(
						eq(ingestRuns.jobId, latestJob.id),
						sql`${ingestRuns.status} in ('failed', 'running')`
					)
				)
				.orderBy(sources.name)
		: [];

	return {
		generatedAt: now,
		sources: collected,
		latestJob: latestJob ? { ...latestJob, failed: failedInJob } : null,
		submittedCount: submitted?.total ?? 0,
		pendingCount: pending?.total ?? 0
	};
});

/**
 * Everything /innsendingar shows: what people sent in, and what the checks decided.
 *
 * Split from `listCollection` so the sources page does not run the submission queries, and the
 * submissions page does not run one query per source.
 */
export const listSubmissions = query(async () => {
	const database = db();
	const now = new Date();

	// Events with no source are human submissions — worth showing, since "anyone can submit" is a
	// stated feature and the page would otherwise imply importers are the only way in.
	const [submitted] = await database
		.select({ total: count() })
		.from(events)
		.where(sql`${events.sourceId} is null`);

	/*
	 * The submission log.
	 *
	 * A count is not enough: the point of publishing verification reasoning is that someone can
	 * read it, and that means a list.
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
		// The page is the log, so it can hold more than the five it had as a section of
		// /datasamling — but it is still "what happened lately", not an archive.
		.limit(20);

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
	 * The conditions are `listSourceCounts`'s submitted branch, from the same clauses.
	 */
	const [submittedLive] = await database
		.select({ total: count() })
		.from(events)
		.where(and(listed, submittedByHand, notOver(now)));

	/*
	 * What the checks actually decided, across every submission we have ever had.
	 *
	 * The README promises the agents' reasoning is auditable; one submission at a time, you can
	 * see why *your* event was declined but never whether the checks are any good. Both ADR 0017 and ADR 0018 name a falsification condition that needs numbers nobody was
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
		submittedCount: submitted?.total ?? 0,
		/** Published, upcoming, and reachable at `/hendingar?kjelde=innsendt`. */
		submittedLiveCount: submittedLive?.total ?? 0,
		pendingCount: pending?.total ?? 0,
		submissions: submissions.map((row) => ({
			...row,
			title: publicSubmissionTitle(row.status, row.title),
			/*
			 * The title was never the only text a sender controls. The venue is a free-text box, and
			 * the notes are a model's summary of the submission, which quotes it when explaining
			 * why it is spam — so withholding the title alone republished the advert one column over.
			 */
			venueName: publicSubmissionTitle(row.status, row.venueName),
			notes: publicSubmissionTitle(row.status, row.notes)
		})),
		/** Per check, what it has decided — and for the two that call a model, what that cost. */
		checks: checkStats,
		curator: curator ?? { nights: 0, picks: 0, latest: null }
	};
});

export type Collection = Awaited<ReturnType<typeof listCollection>>;
export type Submissions = Awaited<ReturnType<typeof listSubmissions>>;
export type SubmissionLogRow = Submissions['submissions'][number];
export type CollectedSource = Collection['sources'][number];
export type CheckStats = Submissions['checks'][number];
export type IngestRunSummary = CollectedSource['runs'][number];
