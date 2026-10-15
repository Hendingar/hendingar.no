import { runIngestCli } from '@hendingar/core/ingest-cli';
import { ingestAll, ingestTeam } from './ingest.ts';
import { teamBySlug } from './teams.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-fotball ingest [--dry-run] [--only <slug>]
 */
await runIngestCli({
	all: ingestAll,
	one: (url, slug, options) => {
		const team = teamBySlug(slug);
		return team ? ingestTeam(url, team, options) : null;
	}
});
