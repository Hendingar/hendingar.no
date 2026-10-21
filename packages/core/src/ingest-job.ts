/**
 * One night's collection, judged as a whole.
 *
 * `ingest_runs` answers "how did this source go". Nothing answered "did the collection happen, and
 * how did it go" except a GitHub email to whoever was watching — and a night that never ran sent
 * no email at all. This is the rule `/datasamling` and `pnpm ingest:job` share, kept pure so the
 * page and the job cannot disagree about what a row means.
 */

export type JobStatus = 'success' | 'partial' | 'failed';

/**
 * The longest a job may run before it is killed. The Container Apps job's `replicaTimeout` is set
 * from the same number in infra; a row still `running` after this was killed mid-run, and never
 * got the chance to say so.
 */
export const JOB_TIMEOUT_MS = 60 * 60_000;

/**
 * How old the last job may be before the page says the collection is late. Daily, plus slack for
 * a slow run and for GitHub's cron, which has fired up to seven hours late.
 */
export const JOB_OVERDUE_MS = 32 * 60 * 60_000;

/** The steps a job runs, in order, under the names its message uses. */
export const JOB_STEPS = ['migreringar', 'innhenting', 'utløp', 'samanslåing', 'kurator'] as const;
export type JobStep = (typeof JOB_STEPS)[number];

/**
 * A job is `failed` when a step it depends on failed, or when not one source ran cleanly — that is
 * an outage, not a bad source. It is `partial` when some sources failed and the others imported.
 * The kurator is optional: a weekend without picks is a page exactly as it was before it existed,
 * so its failure is reported and never colours the night.
 */
export function jobStatus(input: {
	sourcesRun: number;
	sourcesFailed: number;
	failedSteps: readonly JobStep[];
}): JobStatus {
	const fatal = input.failedSteps.filter((s) => s !== 'kurator' && s !== 'innhenting');
	if (fatal.length > 0) return 'failed';
	if (input.sourcesRun === 0 || input.sourcesFailed >= input.sourcesRun) return 'failed';
	if (input.sourcesFailed > 0) return 'partial';
	return 'success';
}

/** The message a job row keeps: what went wrong, in words, or null on a clean night. */
export function jobMessage(
	failedSteps: readonly JobStep[],
	failedSources: readonly string[]
): string | null {
	const parts: string[] = [];
	if (failedSources.length > 0) parts.push(`feila: ${failedSources.join(', ')}`);
	const steps = failedSteps.filter((s) => s !== 'innhenting');
	if (steps.length > 0) parts.push(`steg som feila: ${steps.join(', ')}`);
	return parts.length > 0 ? parts.join('; ').slice(0, 2000) : null;
}

/** What the page needs of a job row. `IngestJob` satisfies it. */
export type JobRow = {
	startedAt: Date;
	finishedAt: Date | null;
	status: 'running' | JobStatus;
};

export type JobHealth =
	| { state: 'none' }
	| { state: 'running'; since: Date }
	| { state: 'interrupted'; since: Date; overdue: boolean }
	| { state: 'done'; status: JobStatus; at: Date; overdue: boolean };

/**
 * How the latest job reads to a visitor.
 *
 * A `running` row is trusted only within the timeout: past it, the container was killed and the
 * row is a job that ended without a word. Overdue is measured from when the last job *started*,
 * because that is the cadence the schedule promises.
 */
export function jobHealth(latest: JobRow | null, now: Date): JobHealth {
	if (!latest) return { state: 'none' };
	const age = now.getTime() - latest.startedAt.getTime();
	const overdue = age > JOB_OVERDUE_MS;
	if (latest.status === 'running') {
		if (age <= JOB_TIMEOUT_MS) return { state: 'running', since: latest.startedAt };
		return { state: 'interrupted', since: latest.startedAt, overdue };
	}
	return {
		state: 'done',
		status: latest.status,
		at: latest.finishedAt ?? latest.startedAt,
		overdue
	};
}
