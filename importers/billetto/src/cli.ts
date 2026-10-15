import { runIngestCli } from '@hendingar/core/ingest-cli';
import { ingestAll, ingestOrganiser } from './ingest.ts';
import { organiserBySlug } from './organisers.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-billetto ingest [--dry-run] [--only <slug>]
 */
await runIngestCli({
	all: ingestAll,
	one: (url, slug, options) => {
		const organiser = organiserBySlug(slug);
		return organiser ? ingestOrganiser(url, organiser, options) : null;
	}
});
