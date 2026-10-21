/**
 * The nightly collection, as one command.
 *
 *   pnpm ingest:job [--dry-run]
 *
 * This is what the scheduler runs, whatever the scheduler is. It used to be five workflow steps —
 * await migrations, every importer, expire, consolidate, the kurator — glued together with
 * `if: always()` and visible only in the Actions log. Now the order and the "keep going after a
 * failure" rules live here, the job writes an `ingest_jobs` row that `/datasamling` reads, and the
 * workflow (or the Container Apps job) is one line that calls it.
 *
 * Each step is a child process running the same `pnpm` script a person would run by hand, so the
 * importers keep their own process, their own `--no-bail`, and their own exit codes.
 *
 * Exit status: non-zero when any source failed or any step other than the kurator did, so the
 * scheduler still marks a bad night red. The kurator is optional — see ADR 0018.
 *
 * Environment: DATABASE_URL (required); INGEST_TRIGGER, INGEST_REVISION; KURATOR_URL, the app's
 * `/api/kurator` to POST once the rows exist (skipped when unset).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb } from '../src/db.ts';
import { jobMessage, jobStatus, type JobStep } from '../src/ingest-job.ts';
import { ingestJobs, ingestRuns, sources } from '../src/schema.ts';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set. Run `pnpm db:up` locally, or set it on the job.');
	process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const trigger = process.env.INGEST_TRIGGER ?? 'manual';
const revision = process.env.INGEST_REVISION ?? process.env.GITHUB_SHA ?? null;
const kuratorUrl = process.env.KURATOR_URL || null;
const root = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The pnpm that started us, not whichever one is first on PATH — locally that is often too old
 * for this workspace (CLAUDE.md, "Worktrees"). `npm_execpath` is a script or a binary.
 */
function pnpmCommand(args: string[]): [string, string[]] {
	const exec = process.env.npm_execpath;
	if (!exec) return ['pnpm', args];
	if (/\.(c|m)?js$/.test(exec)) return [process.execPath, [exec, ...args]];
	return [exec, args];
}

function run(step: JobStep, args: string[], env: Record<string, string> = {}): Promise<boolean> {
	const [command, argv] = pnpmCommand(args);
	console.log(`\n▸ ${step}: pnpm ${args.join(' ')}`);
	return new Promise((resolve) => {
		const child = spawn(command, argv, {
			cwd: root,
			stdio: 'inherit',
			env: { ...process.env, ...env }
		});
		child.on('error', (error) => {
			console.error(`${step}: could not start — ${error.message}`);
			resolve(false);
		});
		child.on('exit', (code) => resolve(code === 0));
	});
}

/** The weekend's picks. Idempotent per day, so a second run costs nothing (ADR 0018). */
async function curate(target: string): Promise<boolean> {
	console.log(`\n▸ kurator: POST ${target}`);
	try {
		// SvelteKit refuses a cross-origin POST, and a server-side fetch sends no Origin of its own.
		const response = await fetch(target, {
			method: 'POST',
			headers: { origin: new URL(target).origin },
			signal: AbortSignal.timeout(5 * 60_000)
		});
		console.log(`kurator: ${response.status} ${(await response.text()).slice(0, 400)}`);
		return response.ok;
	} catch (error) {
		console.error(`kurator: ${error instanceof Error ? error.message : String(error)}`);
		return false;
	}
}

// The schema must match this checkout before anything writes, the job row included.
if (!(await run('migreringar', ['run', 'await-migrations']))) {
	console.error('ingest:job: the database is behind this checkout; nothing ran');
	process.exit(1);
}

if (dryRun) {
	// A dry run writes nothing: no job row, no expiry, no consolidation, no picks.
	const ok = await run('innhenting', ['run', 'ingest', '--', '--dry-run']);
	process.exit(ok ? 0 : 1);
}

const db = createDb(url);
const startedAt = new Date();
const [job] = await db
	.insert(ingestJobs)
	.values({ startedAt, status: 'running', trigger, revision })
	.returning({ id: ingestJobs.id });
if (!job) throw new Error('could not open an ingest job');
console.log(`ingest:job: job ${job.id} started (${trigger}${revision ? `, ${revision}` : ''})`);

const failedSteps: JobStep[] = [];
const step = async (name: JobStep, ok: Promise<boolean>) => {
	if (!(await ok)) failedSteps.push(name);
};

await step('innhenting', run('innhenting', ['run', 'ingest'], { INGEST_JOB_ID: String(job.id) }));
// Each of these runs whatever the importers did: a source that failed tonight still had rows
// yesterday, and those still want expiring and grouping.
await step('utløp', run('utløp', ['run', 'expire']));
await step('samanslåing', run('samanslåing', ['run', 'consolidate']));
// Last, after consolidation, or the kurator could pick one event twice under two sources.
if (kuratorUrl) await step('kurator', curate(kuratorUrl));

const runs = await db
	.select({ status: ingestRuns.status, name: sources.name })
	.from(ingestRuns)
	.innerJoin(sources, eq(ingestRuns.sourceId, sources.id))
	.where(and(eq(ingestRuns.jobId, job.id)));

// `running` here is a source whose process died before it could close its row.
const failedSources = runs.filter((r) => r.status === 'failed' || r.status === 'running');
const counts = { sourcesRun: runs.length, sourcesFailed: failedSources.length };
const status = jobStatus({ ...counts, failedSteps });
const finishedAt = new Date();
const message = jobMessage(
	failedSteps,
	failedSources.map((r) => r.name)
);

await db
	.update(ingestJobs)
	.set({
		finishedAt,
		status,
		...counts,
		durationMs: finishedAt.getTime() - startedAt.getTime(),
		message
	})
	.where(eq(ingestJobs.id, job.id));

console.log(
	`\ningest:job: job ${job.id} ${status} — ${counts.sourcesRun - counts.sourcesFailed} of ${counts.sourcesRun} sources fine` +
		(message ? `; ${message}` : '')
);
process.exit(failedSteps.some((s) => s !== 'kurator') ? 1 : 0);
