import { runIngestCli } from '@hendingar/core/ingest-cli';
import { ingestAll, ingestSite } from './ingest.ts';
import { siteBySlug } from './sites.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-frivilligsentral ingest [--dry-run] [--only <slug>]
 */
await runIngestCli({
	all: ingestAll,
	one: (url, slug, options) => {
		const site = siteBySlug(slug);
		return site ? ingestSite(url, site, options) : null;
	},
	// On a dry run, the rows that would be written.
	describe: (result) => result.preview
});
