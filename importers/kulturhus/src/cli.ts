import { runCli } from '@hendingar/importer/cli';
import { INSTANCES } from './api.ts';
import { ingest } from './ingest.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-kulturhus ingest [--dry-run] [--only <slug>]
 *
 * The 55 lines this replaces were byte-identical in all fifteen importers apart from this noun.
 */
await runCli({
	configs: INSTANCES,
	label: 'venue',
	packageName: '@hendingar/importer-kulturhus',
	run: ingest
});
