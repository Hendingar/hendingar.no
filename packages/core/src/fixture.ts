/**
 * A football fixture, read back out of the title NFF wrote.
 *
 * `importers/fotball` stores a match as its SUMMARY — "Stord Fotball Menn Senior A - Vard
 * Haugesund" — because that is all the calendar feed carries. Two clubs and a grade are in there,
 * and nothing else we hold says who is playing whom.
 *
 * ## Why this is a parser and not a column
 *
 * The obvious alternative is for the importer to split the sides and store them. That is probably
 * where this ends up. It is not where it starts, for one reason: a column is only filled from the
 * next ingest onwards, and the rule below has to be right before it is worth migrating for. A pure
 * function over the title we already have can be read against all 53 fixtures in the committed
 * feeds today, and moved into the importer unchanged the day we want it structured.
 *
 * ## Why the grade is required
 *
 * `" - "` is a common thing to find in a title. "Bygdekino: Kunsten å vere lykkeleg" has no
 * separator, but "Konsert - Koret Lyren" does, and rendering that as a cup tie between Konsert and
 * Koret Lyren would be worse than rendering nothing. So a title is only a fixture when at least one
 * side carries NFF's own grade vocabulary — `Menn Senior A`, `Menn 1`, `Kvinner Senior B`, `G16`.
 * Two clubs in the committed feeds carry no grade at all ("Djerv 1919", "Vard Haugesund"), which is
 * why it is *at least one* side and not both.
 */

/** One side of a fixture: the club as a reader knows it, and the grade NFF files it under. */
export type FixtureSide = {
	/** "Stord Fotball" — the name with the grade taken off. */
	club: string;
	/** "Menn Senior A", or null for the clubs NFF lists without one. */
	grade: string | null;
};

export type Fixture = {
	home: FixtureSide;
	away: FixtureSide;
	/**
	 * The grade, when both sides agree on it — which is all but a handful of fixtures.
	 *
	 * Printed once under the matchup rather than twice beside it: "Menn Senior A" said on both
	 * sides of a VS is noise, and the two sides of a match are by definition the same grade unless
	 * the feed disagrees with itself.
	 */
	grade: string | null;
};

/**
 * NFF's grade vocabulary, anchored to the end of a side.
 *
 * Both spellings of senior are real and both appear in the same feed — "Fitjar Menn senior A" and
 * "Smørås Menn Senior A" are two rows apart. The trailing token is a letter or a number: `A`, `B`,
 * `1`, `2`. The youth form is a single token, `G16` or `J14`.
 */
const GRADE =
	/\s+((?:menn|kvinner|gutar|gutter|jenter)\s+(?:senior\s+)?[a-zæøå0-9]+|[gj]\d{1,2})$/i;

function splitSide(side: string): FixtureSide | null {
	const text = side.replace(/\s+/g, ' ').trim();
	if (!text) return null;
	const match = GRADE.exec(text);
	if (!match) return { club: text, grade: null };
	const club = text.slice(0, match.index).trim();
	// A side that is nothing but a grade is not a club. Nothing in the feeds does this; refusing it
	// here means the tile can never print an empty name.
	if (!club) return { club: text, grade: null };
	return { club, grade: match[1]!.replace(/\s+/g, ' ') };
}

/**
 * "Stord Fotball Menn Senior A - Vard Haugesund" → the two sides, or null for anything else.
 *
 * Split on `" - "` with the spaces, never on the hyphen: Fløy-Flekkerøy is one club and NFF writes
 * it with no spaces around its hyphen, which is the distinction the separator relies on. More than
 * one separator means we cannot tell which one divides the sides, so that is a refusal rather than
 * a guess — `importers/fotball` makes the same call about which team is at home, and for the same
 * reason.
 */
export function parseFixture(title: string | null | undefined): Fixture | null {
	if (!title) return null;
	const parts = title.split(' - ');
	if (parts.length !== 2) return null;

	const home = splitSide(parts[0]!);
	const away = splitSide(parts[1]!);
	if (!home || !away) return null;
	if (!home.grade && !away.grade) return null;

	return {
		home,
		away,
		grade: home.grade && home.grade.toLowerCase() === away.grade?.toLowerCase() ? home.grade : null
	};
}
