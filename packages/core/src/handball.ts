import type { Fixture } from './fixture.ts';

/**
 * A handball match, as `importers/handball` writes its title and as the app reads it back.
 *
 * ## Why both halves live here
 *
 * Football's titles are NFF's own SUMMARY, so `parseFixture` has to recognise a format somebody
 * else chose — hence its grade vocabulary and its refusals. Handball is the other way round: the
 * handball.no schedule is structured JSON, with home and away as separate fields, and the title is
 * one *we* compose. So the writer and the reader are one module, and they cannot drift apart: the
 * importer calls `handballTitle`, the card calls `parseHandballMatch`, and the round trip is
 * tested.
 *
 * ## Why a title and not a column
 *
 * The same reason `fixture.ts` gives: the listing already carries the title everywhere a card is
 * drawn, and a column would be one more thing to thread through every query for two sources. The
 * title is also what a reader sees, and "Handball: Stord - Ros (menn)" says the sport, the two
 * sides and which team it is — the men's and the women's sides share a club, a hall and a name.
 *
 * ## Why football's parser never claims one
 *
 * `parseFixture` needs NFF's grade vocabulary on at least one side, and "Handball: Stord" and
 * "Ros (menn)" carry none — the grade is in brackets, not at the end of a side. The card picks
 * handball first anyway, so the two never have to agree.
 */

export type HandballTeam = 'menn' | 'kvinner';

export type HandballMatch = Fixture & {
	sport: 'handball';
	/** Which of the club's senior teams is playing. */
	team: HandballTeam;
};

const PREFIX = 'Handball: ';
const SEPARATOR = ' - ';
const TITLE = /^Handball: (.+) - (.+) \((menn|kvinner)\)$/;

/** "Menn", for the grade a `Fixture` carries and the JSON-LD prints. */
const GRADE: Readonly<Record<HandballTeam, string>> = { menn: 'Menn', kvinner: 'Kvinner' };

/**
 * A club name that cannot break the separator.
 *
 * handball.no's long names do contain " - " — "Bsi - Bergen Studentidrettslag" — and a title with
 * two separators cannot be split back into two sides. The importer uses short names, which have
 * none today; this is what keeps tomorrow's from producing a title the parser refuses.
 */
function clean(name: string): string {
	return name
		.replace(/\s+-\s+/g, '-')
		.replace(/\s+/g, ' ')
		.trim();
}

/** "Handball: Stord - Ros (menn)". */
export function handballTitle(home: string, away: string, team: HandballTeam): string {
	return `${PREFIX}${clean(home)}${SEPARATOR}${clean(away)} (${team})`;
}

/** The title back into its sides, or null for anything `handballTitle` did not write. */
export function parseHandballMatch(title: string | null | undefined): HandballMatch | null {
	if (!title) return null;
	const match = TITLE.exec(title.trim());
	if (!match) return null;
	const [, home, away, rawTeam] = match;
	if (!home || !away || home.includes(SEPARATOR) || away.includes(SEPARATOR)) return null;
	const team: HandballTeam = rawTeam === 'kvinner' ? 'kvinner' : 'menn';
	const grade = GRADE[team];
	return {
		sport: 'handball',
		team,
		home: { club: home, grade },
		away: { club: away, grade },
		grade
	};
}
