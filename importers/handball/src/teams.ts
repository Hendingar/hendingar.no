import type { HandballTeam as TeamKind } from '@hendingar/core/handball';

/**
 * Local handball teams, read from the schedule handball.no shows on each team's page.
 *
 * ## Permission, because robots.txt says otherwise
 *
 * The team page (`/system/kamper/lag/`) is open to crawlers. The schedule on it is not in the
 * page: the page's own script fetches it from `/api/AjaxData/TerminListeForTeam`, and `/api/` is
 * under `Disallow:` in handball.no's robots.txt. docs/event-sources.md says that is where we stop
 * and ask, and that is what happened: **Norges Håndballforbund gave hendingar.no permission to
 * read it.** That permission is the whole basis on which this source is collected. Without it
 * this importer should not exist, and if it is ever withdrawn the importer goes.
 *
 * What we ask for is exactly what the page asks for when a visitor opens "Terminliste": one team
 * page and one schedule per team, once a day, identifying ourselves.
 */
export type HandballTeam = {
	/** Our `sources.slug`. Stable — changing it orphans every imported event. */
	slug: string;
	name: string;
	/** handball.no's team id: `lagid` in the page URL, `id` in the schedule URL. */
	teamId: number;
	/** Which of the club's senior sides this is. Printed in the title and on the card. */
	team: TeamKind;
	/** The club as the title and the card name it. The schedule says "Stord" too. */
	club: string;
	/**
	 * The hall this team plays at home, by handball.no's `venueUnitId`.
	 *
	 * A home match is decided by `homeTeamId`, which is a fact in this feed — football has to
	 * infer it from the ground. The venue id is only for spelling: a home match in the usual hall
	 * gets `venueName`, one moved elsewhere keeps the hall the schedule names.
	 */
	homeVenueUnitId: number;
	/** The venue name we store for the home hall. From config, so it reads consistently. */
	venueName: string;
	region: string;
	attribution: string;
	timezone: string;
	scheduleCron: string;
	iconUrl: string | null;
	trusted: boolean;
};

const STORD = {
	club: 'Stord',
	homeVenueUnitId: 5294,
	venueName: 'Stordhallen',
	region: 'Sunnhordland',
	attribution: 'Norges Håndballforbund',
	timezone: 'Europe/Oslo',
	scheduleCron: '0 5 * * *',
	iconUrl: 'https://www.handball.no/favicon.ico',
	trusted: true
};

export const TEAMS: readonly HandballTeam[] = [
	{
		...STORD,
		slug: 'handball-stord-menn',
		name: 'Stord Håndball Menn',
		teamId: 854678,
		team: 'menn'
	},
	{
		...STORD,
		slug: 'handball-stord-kvinner',
		name: 'Stord Håndball Kvinner',
		teamId: 225155,
		team: 'kvinner'
	}
];

const ORIGIN = 'https://www.handball.no';

/** The team page a reader can open, and where the current season is named. */
export const teamUrl = (team: HandballTeam) => `${ORIGIN}/system/kamper/lag/?lagid=${team.teamId}`;

/** The season's schedule, as the team page's "Terminliste" asks for it. */
export const scheduleUrl = (team: HandballTeam, seasonId: number) =>
	`${ORIGIN}/api/AjaxData/TerminListeForTeam?id=${team.teamId}&seasonId=${seasonId}`;

/** One match's own page. */
export const matchUrl = (matchId: number) => `${ORIGIN}/system/kamper/kamp/?matchid=${matchId}`;

export function teamBySlug(slug: string): HandballTeam | undefined {
	return TEAMS.find((t) => t.slug === slug);
}
