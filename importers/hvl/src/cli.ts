import { runIngestCli } from '@hendingar/core/ingest-cli';
import { ingestAll, ingestCampus } from './ingest.ts';
import { campusBySlug } from './campuses.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-hvl ingest [--dry-run] [--only <slug>]
 */
await runIngestCli({
	all: ingestAll,
	one: (url, slug, options) => {
		const campus = campusBySlug(slug);
		return campus ? ingestCampus(url, campus, options) : null;
	}
});
