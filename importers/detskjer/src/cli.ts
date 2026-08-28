import { ingest } from './ingest.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-detskjer ingest [--dry-run]
 */
const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set. Run `pnpm db:up` locally, or set it in CI.');
	process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const trigger = process.env.INGEST_TRIGGER ?? (process.env.CI ? 'schedule' : 'manual');
const revision = process.env.GITHUB_SHA ?? null;

try {
	const result = await ingest(url, { dryRun, trigger, revision });
	console.log(
		[
			`status=${result.status}`,
			`fetched=${result.fetched}`,
			`created=${result.created}`,
			`updated=${result.updated}`,
			`unchanged=${result.unchanged}`,
			`rejected=${result.rejected}`,
			`ms=${result.durationMs}`
		].join(' ')
	);
	if (result.message) console.log(`notes: ${result.message}`);
	// A partial run is not a failure — the source changed shape for some records and the rest
	// imported fine — but it must be visible in the job output.
	process.exit(result.status === 'failed' ? 1 : 0);
} catch (error) {
	console.error('ingest failed:', error instanceof Error ? error.message : error);
	process.exit(1);
}
