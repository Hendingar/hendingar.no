import { runIngestCli } from '@hendingar/core/ingest-cli';
import { ingestAll, ingestShop } from './ingest.ts';
import { shopBySlug } from './instances.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-ticketco ingest [--dry-run] [--only <slug>]
 */
await runIngestCli({
	all: ingestAll,
	one: (url, slug, options) => {
		const shop = shopBySlug(slug);
		return shop ? ingestShop(url, shop, options) : null;
	}
});
