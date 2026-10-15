import { runIngestCli } from '@hendingar/core/ingest-cli';
import { ingestAll, ingestInstance } from './ingest.ts';
import { instanceBySlug } from './api.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-checkin ingest [--dry-run] [--only <slug>]
 */
await runIngestCli({
	all: ingestAll,
	one: (url, slug, options) => {
		const instance = instanceBySlug(slug);
		return instance ? ingestInstance(url, instance, options) : null;
	}
});
