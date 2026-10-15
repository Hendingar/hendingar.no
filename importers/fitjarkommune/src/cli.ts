import { runIngestCli } from '@hendingar/core/ingest-cli';
import { ingest } from './ingest.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-fitjarkommune ingest [--dry-run]
 */
await runIngestCli({ all: async (url, options) => [await ingest(url, options)] });
