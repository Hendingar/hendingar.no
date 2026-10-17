import { getJson, parseEvents } from './api.ts';
import { organisersOfHandEnteredEvents, parseOrganizerRows } from './organisers.ts';
import { SITES, eventsUrl, organizersUrl } from './sites.ts';

/**
 * Which local groups publish on each Aktivitet for Alle portal by hand.
 *
 *   pnpm --filter @hendingar/importer-aktivitetforalle report:organisers
 *
 * Reads two collections per portal — events and organisers, the same two the daily import already
 * reads — and writes nothing. Not part of `ingest`, and not scheduled: it is a question asked by a
 * person, so it runs when one asks it.
 */
for (const site of SITES) {
	const events = parseEvents(await getJson(eventsUrl(site)));
	const organizers = parseOrganizerRows(await getJson(organizersUrl(site)));
	const rows = organisersOfHandEnteredEvents(events.rows, organizers);
	const total = rows.reduce((sum, r) => sum + r.total, 0);

	console.log(`\n${site.name} — ${rows.length} organisers, ${total} hand-entered public rows`);
	console.log('  rows  activ  arr  organiser');
	for (const r of rows) {
		const id = r.organizerId ? ` [${r.organizerId}]` : '';
		console.log(
			`  ${String(r.total).padStart(4)}  ${String(r.activities).padStart(5)}  ${String(r.arrangements).padStart(3)}  ${r.name}${id}`
		);
	}
	if (events.rejected.length > 0)
		console.log(`  (${events.rejected.length} rows failed validation)`);
}
