import { runIngestCli } from '@hendingar/core/ingest-cli';
import { ingestAll, ingestSite } from './ingest.ts';
import { siteBySlug } from './sites.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-aktivitetforalle ingest [--dry-run] [--only <slug>]
 */
await runIngestCli({
	all: ingestAll,
	one: (url, slug, options) => {
		const site = siteBySlug(slug);
		return site ? ingestSite(url, site, options) : null;
	}
});
