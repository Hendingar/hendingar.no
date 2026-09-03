/**
 * Local football teams, imported from NFF's published calendar feeds.
 *
 * ## Why a feed and not the page
 *
 * `fotball.no/robots.txt` ends with `User-agent: * / Disallow: /` — everything is closed to
 * everything except a named list of search-engine bots. So the team page is not ours to scrape,
 * and no part of this importer ever fetches it.
 *
 * NFF separately publishes each team's fixtures as an iCal subscription, offered on that page as a
 * `webcal://` link. A subscription feed exists precisely to be fetched on a schedule by a machine
 * — that is the whole meaning of subscribing to one — and we read it exactly as a calendar client
 * would: one URL per team, once a day, identifying ourselves.
 *
 * That distinction is the entire basis on which this source is collected. If NFF ever closes the
 * feed, this importer stops; it does not fall back to the page.
 */
export type FotballTeam = {
	/** Our `sources.slug`. Stable — changing it orphans every imported event. */
	slug: string;
	name: string;
	/** NFF's team id, the `fiksId` in the team page URL and the `teamId` in the feed URL. */
	fiksId: string;
	/**
	 * The ground this team plays at home, matched against the feed's `LOCATION`.
	 *
	 * A team's calendar carries its away fixtures too — Bremnes travels to Bergen a dozen times a
	 * season — and a listing for Sunnhordland has no business advertising a match in Nesttun. Only
	 * matches at the home ground are imported.
	 *
	 * Matched case-insensitively and with spaces collapsed, because the ground is written by hand:
	 * the feed says `ScaleAQ Stadion` where a person would write "Scale AQ stadion".
	 */
	homeGround: RegExp;
	/** The venue name we store. Taken from config, not the feed, so it reads consistently. */
	venueName: string;
	region: string;
	attribution: string;
	timezone: string;
	scheduleCron: string;
	iconUrl: string | null;
	trusted: boolean;
};

export const TEAMS: readonly FotballTeam[] = [
	{
		slug: 'stord-fotball',
		name: 'Stord Fotball',
		fiksId: '133860',
		homeGround: /stord\s*stadion/i,
		venueName: 'Stord stadion',
		region: 'Sunnhordland',
		attribution: 'Norges Fotballforbund',
		timezone: 'Europe/Oslo',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://www.fotball.no/favicon.ico',
		trusted: true
	},
	{
		slug: 'bremnes-fotball',
		name: 'Bremnes',
		fiksId: '30365',
		homeGround: /scale\s*aq\s*stadion/i,
		venueName: 'ScaleAQ Stadion',
		region: 'Sunnhordland',
		attribution: 'Norges Fotballforbund',
		timezone: 'Europe/Oslo',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://www.fotball.no/favicon.ico',
		trusted: true
	}
];

/** The team page a reader can open. We never fetch this — it is for attribution only. */
export const teamUrl = (team: FotballTeam) =>
	`https://www.fotball.no/fotballdata/lag/hjem/?fiksId=${team.fiksId}`;

/** The published iCal subscription. The `webcal://` link on the team page, over https. */
export const feedUrl = (team: FotballTeam) =>
	`https://www.fotball.no/footballapi/Calendar/GetCalendar?teamId=${team.fiksId}`;

export function teamBySlug(slug: string): FotballTeam | undefined {
	return TEAMS.find((t) => t.slug === slug);
}
