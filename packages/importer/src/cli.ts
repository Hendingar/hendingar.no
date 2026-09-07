import type { IngestResult, RunOptions, SourceConfig } from './contract.ts';

/**
 * The entry point every importer's `cli.ts` was.
 *
 * All fifteen were the same 55 lines. Measured with `diff` against one another, the differences were:
 * the package name in a doc comment, the import path, and the noun — `site` / `organiser` / `team` /
 * `campus` / `association` / `instance` — in the `--only` lookup and its error message. `detskjer`
 * had forked into a 37-line variant with no `--only` at all. Nothing else differed: not the
 * `DATABASE_URL` guard, not the argument parsing, not the eight `key=value` log fields, not the exit
 * codes.
 *
 * So this takes the noun as a parameter and every `cli.ts` becomes a call.
 *
 * ## Exit codes, which are load-bearing
 *
 * A **partial** run is not a failure: some records changed shape and the rest imported fine, and the
 * job should stay green while the run's own row says `partial` on /datasamling. Only an outright
 * failure exits non-zero. `pnpm ingest` runs with `--no-bail`, so a non-zero exit costs this source
 * and nothing else — but it must still be non-zero, or a source that stops working is invisible.
 */

export type CliOptions<TConfig extends SourceConfig> = {
	/** Every configured source, for a run with no `--only`. */
	configs: readonly TConfig[];
	/** The noun this importer's config entries go by, for `--only` and its error message. */
	label: string;
	/** The workspace package name, for the usage line. */
	packageName: string;
	run: (
		connectionString: string,
		configs: readonly TConfig[],
		options: RunOptions
	) => Promise<IngestResult[]>;
};

/**
 * Reads the environment, runs, prints, and exits. Never returns.
 *
 * `process.exit` rather than a thrown error or a returned code: this is the last thing a scheduled
 * job does, and the exit status is the only signal the workflow reads.
 */
export async function runCli<TConfig extends SourceConfig>(
	options: CliOptions<TConfig>
): Promise<never> {
	const { configs, label, packageName, run } = options;

	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error('DATABASE_URL is not set. Run `pnpm db:up` locally, or set it in CI.');
		return process.exit(1);
	}

	const dryRun = process.argv.includes('--dry-run');
	const onlyIndex = process.argv.indexOf('--only');
	const only = onlyIndex === -1 ? null : process.argv[onlyIndex + 1];
	const trigger = process.env.INGEST_TRIGGER ?? (process.env.CI ? 'schedule' : 'manual');
	const revision = process.env.GITHUB_SHA ?? null;

	if (only !== null && (only === undefined || only.startsWith('--'))) {
		// `--only` followed by another flag used to read that flag as a slug and then report it as an
		// unknown source, which points at the config file rather than at the command line.
		console.error(`--only needs a ${label} slug. Usage:`);
		console.error(`  pnpm --filter ${packageName} ingest [--dry-run] [--only <slug>]`);
		return process.exit(1);
	}

	try {
		let selected = configs;
		if (only) {
			const match = configs.find((config) => config.slug === only);
			if (!match) {
				console.error(
					`unknown ${label} '${only}'. Known: ${configs.map((c) => c.slug).join(', ')}`
				);
				return process.exit(1);
			}
			selected = [match];
		}

		const results = await run(url, selected, { dryRun, trigger, revision });

		for (const result of results) {
			console.log(
				[
					`source=${result.slug}`,
					`status=${result.status}`,
					`fetched=${result.fetched}`,
					`created=${result.created}`,
					`updated=${result.updated}`,
					`unchanged=${result.unchanged}`,
					`rejected=${result.rejected}`,
					`ms=${result.durationMs}`
				].join(' ')
			);
			if (result.message) console.log(`  notes: ${result.message}`);
		}

		return process.exit(results.some((result) => result.status === 'failed') ? 1 : 0);
	} catch (error) {
		console.error('ingest failed:', error instanceof Error ? error.message : error);
		return process.exit(1);
	}
}
