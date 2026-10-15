import { runIngestCli } from '@hendingar/core/ingest-cli';
import { ingestAll, ingestCalendar } from './ingest.ts';
import { calendarBySlug } from './calendars.ts';

/**
 * Entry point for the scheduled job.
 *   pnpm --filter @hendingar/importer-luma ingest [--dry-run] [--only <slug>]
 */
await runIngestCli({
	all: ingestAll,
	one: (url, slug, options) => {
		const calendar = calendarBySlug(slug);
		return calendar ? ingestCalendar(url, calendar, options) : null;
	}
});
