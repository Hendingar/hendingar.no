import { feedUrl, type FotballTeam } from './teams.ts';

/**
 * Fetching one team's published calendar subscription.
 *
 * Exactly one request per team per run, to the feed URL NFF offers on the team page as a
 * `webcal://` link — never to the page itself, which robots.txt closes. See teams.ts.
 */

const HEADERS = {
	// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
	'user-agent': 'hendingar.no importer (+https://hendingar.no)',
	accept: 'text/calendar'
};

export type ReadFeed = (team: FotballTeam) => Promise<string>;

export const readFeed: ReadFeed = async (team) => {
	const url = feedUrl(team);
	const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	const body = await response.text();
	/*
	 * A calendar, or nothing.
	 *
	 * If NFF ever answers this URL with an HTML error page or a login wall, importing zero fixtures
	 * and reporting success is the failure mode /datasamling exists to prevent. Fail loudly.
	 */
	if (!body.includes('BEGIN:VCALENDAR')) {
		throw new Error(`${url} did not return an iCalendar document`);
	}
	return body;
};
