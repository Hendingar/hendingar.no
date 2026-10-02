/**
 * Club crests, as committed data.
 *
 * ## Where these came from, and why they are a table rather than a fetch
 *
 * NFF serves every club's crest from `images.fotball.no/clublogos/<id>.png`, and the id appears on
 * the club's pages on `fotball.no`. That site's robots.txt ends with `User-agent: * / Disallow: /`,
 * which is the whole basis on which `importers/fotball` collects from a calendar subscription and
 * never from the site — see the note in its `teams.ts`.
 *
 * **Nothing in the running system fetches fotball.no.** The ids below were read once, by hand, off
 * the two team pages a person can open in a browser, and written down here. The importer is
 * untouched; it still reads one subscription feed per team per day and nothing else. What a reader's
 * browser then loads is an image from `images.fotball.no`, which is what the match page itself does.
 *
 * That is a judgement, and it is reversible: delete this file's entries and every card falls back to
 * the wordmark it already had. If NFF would rather we did not, that is the whole remedy.
 *
 * ## Adding a club
 *
 * A fixture against a club with no entry draws the wordmark and no crest, which is the designed
 * fallback rather than a hole. To fill one in: open that club's match on `fotball.no` in a browser,
 * read the `clublogos/<id>.png` off the two crests it shows, and add the line. The key is the club
 * name as `parseFixture` produces it — the title with NFF's grade taken off — lowercased.
 */

/**
 * Club name → NFF's club id.
 *
 * Covers every club in the committed feeds, which is one season of Stord's and Bremnes' fixtures.
 * Both spellings of the two home clubs are here because NFF writes "Stord" on some pages and
 * "Stord Fotball" on others, and the feed is not consistent about which reaches us.
 */
const CREST_IDS: Readonly<Record<string, string>> = {
	askøy: '1681',
	austevoll: '877',
	brann: '781',
	bremnes: '827',
	bønes: '1618',
	'djerv 1919': '708',
	fana: '1614',
	fitjar: '837',
	flaktveit: '814',
	'fløy-flekkerøy': '630',
	fyllingen: '2422',
	fyllingsdalen: '3129',
	førde: '952',
	galgen: '1903',
	gneist: '786',
	'juristforeningen studentidrettslag': '3107',
	mathopen: '796',
	'nore neset': '873',
	nymark: '801',
	os: '1662',
	osterøy: '900',
	smørås: '805',
	sogndal: '1675',
	stord: '3076',
	'stord fotball': '3076',
	'vard haugesund': '710',
	varegg: '1853',
	viggo: '808',
	ørnen: '3260',
	åsane: '1633',
	'åsane fotball': '1633'
};

/** The crest for a club, or null for one we have not written down. */
export function crestUrl(club: string): string | null {
	const id = CREST_IDS[club.toLowerCase().replace(/\s+/g, ' ').trim()];
	return id ? `https://images.fotball.no/clublogos/${id}.png` : null;
}

/** Only for the test that asserts the table still covers the fixtures we actually hold. */
export const KNOWN_CLUBS: readonly string[] = Object.keys(CREST_IDS);
