/**
 * The entry point every importer's `pnpm ingest` runs.
 *
 *   pnpm --filter @hendingar/importer-<x> ingest [--dry-run] [--only <slug>]
 *
 * Twenty-five `cli.ts` files said this, differing in the import names and whether the log line
 * named its source. Exit status is the contract with `pnpm ingest:job` and the scheduler behind it: a partial run
 * is not a failure — some records changed shape and the rest imported fine — but it must be
 * visible in the job output. Any outright failure fails the job.
 */

import type { IngestResult, RunOptions } from './ingest-run.ts';

export type IngestCli<R extends IngestResult> = {
	/** Every source this importer collects. */
	all: (url: string, options: RunOptions) => Promise<R[]>;
	/** One source by slug for `--only`, or null when the slug is not one of this importer's. */
	one?: (url: string, slug: string, options: RunOptions) => Promise<R> | null;
	/** Extra lines under a result, for an importer with more to say than the counts. */
	describe?: (result: R) => string[];
};

export async function runIngestCli<R extends IngestResult>(cli: IngestCli<R>): Promise<never> {
	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error('DATABASE_URL is not set. Run `pnpm db:up` locally, or set it in CI.');
		process.exit(1);
	}

	const dryRun = process.argv.includes('--dry-run');
	const onlyIndex = process.argv.indexOf('--only');
	const only = onlyIndex === -1 ? null : (process.argv[onlyIndex + 1] ?? null);
	const options: RunOptions = {
		dryRun,
		trigger: process.env.INGEST_TRIGGER ?? (process.env.CI ? 'schedule' : 'manual'),
		revision: process.env.INGEST_REVISION ?? process.env.GITHUB_SHA ?? null,
		// Set by `pnpm ingest:job` for the importers it starts; absent when one is run by hand.
		jobId: jobIdFrom(process.env.INGEST_JOB_ID)
	};

	try {
		let results: R[];
		if (only) {
			const run = cli.one?.(url, only, options) ?? null;
			if (!run) {
				console.error(`unknown source '${only}'`);
				process.exit(1);
			}
			results = [await run];
		} else {
			results = await cli.all(url, options);
		}

		for (const r of results) {
			console.log(
				[
					`source=${r.slug}`,
					`status=${r.status}`,
					`fetched=${r.fetched}`,
					`created=${r.created}`,
					`updated=${r.updated}`,
					`unchanged=${r.unchanged}`,
					`rejected=${r.rejected}`,
					`ms=${r.durationMs}`
				].join(' ')
			);
			if (r.message) console.log(`  notes: ${r.message}`);
			for (const line of cli.describe?.(r) ?? []) console.log(`  ${line}`);
		}

		process.exit(results.some((r) => r.status === 'failed') ? 1 : 0);
	} catch (error) {
		console.error('ingest failed:', error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

/** `INGEST_JOB_ID` as a row id, or null. A value that is not one is ignored rather than trusted. */
export function jobIdFrom(value: string | undefined): number | null {
	if (!value || !/^[1-9]\d*$/.test(value)) return null;
	return Number(value);
}
