import { runCli } from '@hendingar/importer/cli';
import { INSTANCES } from './api.ts';
import { ingest } from './ingest.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-fjordnorway ingest [--dry-run] [--only <slug>]
 */
await runCli({
	configs: INSTANCES,
	label: 'instance',
	packageName: '@hendingar/importer-fjordnorway',
	run: ingest
});
