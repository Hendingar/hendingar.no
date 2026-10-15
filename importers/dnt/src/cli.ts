import { runIngestCli } from '@hendingar/core/ingest-cli';
import { ingestAll, ingestAssociation } from './ingest.ts';
import { associationBySlug } from './associations.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-dnt ingest [--dry-run] [--only <slug>]
 */
await runIngestCli({
	all: ingestAll,
	one: (url, slug, options) => {
		const association = associationBySlug(slug);
		return association ? ingestAssociation(url, association, options) : null;
	}
});
