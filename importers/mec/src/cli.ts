import { ingestAll, ingestInstance } from './ingest.ts';
import { instanceBySlug } from './instances.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-mec ingest [--dry-run] [--only <slug>]
 */
const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set. Run `pnpm db:up` locally, or set it in CI.');
	process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex === -1 ? null : process.argv[onlyIndex + 1];
const trigger = process.env.INGEST_TRIGGER ?? (process.env.CI ? 'schedule' : 'manual');
const revision = process.env.GITHUB_SHA ?? null;

try {
	let results;
	if (only) {
		const instance = instanceBySlug(only);
		if (!instance) {
			console.error(`unknown instance '${only}'`);
			process.exit(1);
		}
		results = [await ingestInstance(url, instance, { dryRun, trigger, revision })];
	} else {
		results = await ingestAll(url, { dryRun, trigger, revision });
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
	}

	// A partial run is not a failure — some records changed shape and the rest imported fine — but
	// it must be visible in the job output. Any outright failure fails the job.
	process.exit(results.some((r) => r.status === 'failed') ? 1 : 0);
} catch (error) {
	console.error('ingest failed:', error instanceof Error ? error.message : error);
	process.exit(1);
}
