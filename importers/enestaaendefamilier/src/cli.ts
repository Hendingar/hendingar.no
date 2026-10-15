import { runIngestCli } from '@hendingar/core/ingest-cli';
import { ingestAll, ingestGroup } from './ingest.ts';
import { groupBySlug } from './groups.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-enestaaendefamilier ingest [--dry-run] [--only <slug>]
 */
await runIngestCli({
	all: ingestAll,
	one: (url, slug, options) => {
		const group = groupBySlug(slug);
		return group ? ingestGroup(url, group, options) : null;
	}
});
