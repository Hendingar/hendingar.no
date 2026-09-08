/**
 * Where hendingar.no publishes — and how a stated place is matched against it.
 *
 * A concert in Grieghallen, Bergen was submitted, passed every check, and went live. Nothing was
 * broken: no check asked where the event was. Plausibility asked whether it looked real (it did),
 * normalisation whether the fields parsed (they did), and "Bergen" travelled through the pipeline
 * as a string nobody compared to anything. A local calendar that publishes an event 90km away is
 * not slightly wrong, it is a different product.
 *
 * So coverage is a check of its own, and it is a **rule**: which municipality a place is in is a
 * fact, not a judgement, and asking a model to decide it would make a cheap, explainable answer
 * expensive and unpredictable. See `docs/decisions/0015-coverage-area.md`.
 *
 * Pure — no I/O, no clock. `services/verifier` needs the same lists in Python and cannot import
 * this, so that copy is asserted against this file in the service's contract test, the same way
 * the check names are (CLAUDE.md rule 1, and the one place it cannot be enforced by a compiler).
 */

/** The municipalities we publish. Adding one here adds it everywhere, copy included. */
export const COVERED_MUNICIPALITIES = ['Stord', 'Bømlo', 'Fitjar'] as const;

export type CoveredMunicipality = (typeof COVERED_MUNICIPALITIES)[number];

/**
 * Places inside each covered municipality, because almost nobody writes the municipality.
 *
 * A poster says "Leirvik" and a sender types "Leirvik"; the postal towns our own importers already
 * read are `5410 Sagvåg` and `5430 Bremnes`, neither of which is a municipality — see the comment
 * in `importers/allevents/src/ingest.ts`, which refuses to write either into a `municipality`
 * column for exactly that reason. Those names are still the strongest evidence we get about where
 * an event is, so they belong somewhere, and this is the somewhere.
 *
 * Villages, postal towns and the built-up areas people name — not an exhaustive gazetteer. It does
 * not have to be: a name that is not here produces "we could not tell", which sends the submission
 * to its sender rather than refusing it. The list grows from what people actually type.
 *
 * One word per entry. A two-word entry could never match, because matching is per token — there is
 * a test that asserts it.
 */
export const COVERED_PLACES: Record<CoveredMunicipality, readonly string[]> = {
	Stord: [
		'Leirvik',
		'Sagvåg',
		'Litlabø',
		'Nysæter',
		'Ådland',
		'Rommetveit',
		'Grunnavågen',
		'Huglo',
		'Føyno',
		'Heiane',
		'Valvatna',
		'Tysevågen'
	],
	Bømlo: [
		'Svortland',
		'Bremnes',
		'Moster',
		'Mosterhamn',
		'Rubbestadneset',
		'Langevåg',
		'Espevær',
		'Finnås',
		'Meling',
		'Hollundsdalen',
		'Foldrøyhamn',
		'Hiskjo',
		'Urangsvåg',
		'Våge',
		'Økland',
		'Vorland',
		'Gilje',
		'Sakseid',
		'Innvær',
		'Goddo',
		'Rolvsnes',
		'Siggjarvåg'
	],
	Fitjar: [
		'Rimbareid',
		'Årskog',
		'Sælevik',
		'Dåfjorden',
		'Øvrebygda',
		'Vestbøstad',
		'Osternes',
		'Koløy',
		'Selsøy',
		'Engesund'
	]
};

/**
 * Words that name somewhere, and do not name a municipality.
 *
 * These are the reason the check has three outcomes rather than two. "Vestland" is not one of our
 * three, and it is also not evidence the event is somewhere else — Stord is in Vestland. Reading a
 * county, a country or the word "kommune" as "not here" would refuse local events for describing
 * themselves at the wrong zoom level, which is a worse failure than the one this check exists to
 * fix: an event we cannot place goes back to the person who can place it.
 *
 * "Sunnhordland" belongs here for the same reason and is the likeliest of the lot — it is the
 * region all three municipalities are in, and what the local paper calls itself.
 */
export const UNCOMMITTED_PLACE_WORDS = [
	'vestland',
	'vestlandet',
	'hordaland',
	'sunnhordland',
	'sunnhordaland',
	'noreg',
	'norge',
	'norway',
	'kommune',
	'kommunen',
	'fylke',
	'ukjend',
	'ukjent'
] as const;

/**
 * `Bømlo` → `bomlo`, `5410 SAGVÅG` → `['5410', 'sagvag']`.
 *
 * Tokens, not a substring search, and the reason is Stordal — a place in Møre og Romsdal, 400km
 * north, that contains "Stord". `'stordal'.includes('stord')` is true and would publish it here.
 *
 * Folded so a sender who has no Norwegian keyboard, or is typing on a phone that gave up, still
 * matches: `Bomlo`, `Sagvag` and `Aardland` are all things people type for places whose names they
 * know perfectly well.
 */
const FOLD: Record<string, string> = { ø: 'o', å: 'a', æ: 'ae' };

export function placeTokens(value: string): string[] {
	return value
		.toLowerCase()
		.replace(/[øåæ]/g, (c) => FOLD[c] ?? c)
		.normalize('NFD')
		.replace(/\p{Mn}/gu, '')
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

/** Every token that means "inside", mapped to the municipality it belongs to. */
const INSIDE: ReadonlyMap<string, CoveredMunicipality> = new Map(
	COVERED_MUNICIPALITIES.flatMap((municipality) =>
		[municipality, ...COVERED_PLACES[municipality]].flatMap((place) =>
			placeTokens(place).map((token) => [token, municipality] as const)
		)
	)
);

const UNCOMMITTED = new Set<string>(UNCOMMITTED_PLACE_WORDS);

export type CoverageMatch =
	/** A covered place was named, and `matched` is the word that said so. */
	| { state: 'inside'; municipality: CoveredMunicipality; matched: string }
	/** Somewhere was named, and it is not one of ours. */
	| { state: 'outside'; stated: string }
	/** Nothing placed the event, or what did was a county rather than a municipality. */
	| { state: 'unknown'; reason: 'nothing-stated' | 'too-broad' };

/**
 * Where is this event, as far as anything we were told can say?
 *
 * The municipality field decides it when it says something usable. Otherwise the venue name gets a
 * look, because it very often carries the place — "Stord kulturhus", "Moster Amfi", "Bømlohallen"
 * — and a submission that names its venue and omits its municipality is the common case, not an
 * edge one.
 *
 * Deliberately asymmetric: a covered name **anywhere** we look means inside, while only the
 * municipality field can mean outside. Free text is evidence that a place is ours and poor
 * evidence that it is not — an "outside" read off a venue name would refuse a Stord event held at
 * "Bergen Bar", and there is one of those in most towns in Norway.
 */
export function classifyCoverage(input: {
	municipality?: string | null;
	venueName?: string | null;
}): CoverageMatch {
	const stated = input.municipality?.trim() ?? '';
	const statedTokens = placeTokens(stated);

	for (const token of statedTokens) {
		const municipality = INSIDE.get(token);
		if (municipality) return { state: 'inside', municipality, matched: token };
	}

	for (const token of placeTokens(input.venueName?.trim() ?? '')) {
		const municipality = INSIDE.get(token);
		if (municipality) return { state: 'inside', municipality, matched: token };
	}

	if (statedTokens.length === 0) return { state: 'unknown', reason: 'nothing-stated' };
	if (statedTokens.every((token) => UNCOMMITTED.has(token))) {
		return { state: 'unknown', reason: 'too-broad' };
	}
	return { state: 'outside', stated };
}

/**
 * "Stord, Bømlo og Fitjar" — the list, written out, from the list itself.
 *
 * Copy that names the municipalities is copy that goes stale the day a fourth one is added, and
 * this project has already shipped a landing page advertising a "Geokoding" stage the pipeline
 * never ran. So the sentence is generated, and `eller` is a parameter because a question needs it
 * ("Skjer hendinga i Stord, Bømlo eller Fitjar?") and a statement does not.
 */
export function coveredMunicipalitiesSentence(conjunction: 'og' | 'eller' = 'og'): string {
	const names: string[] = [...COVERED_MUNICIPALITIES];
	const last = names.pop();
	if (last === undefined) return '';
	if (names.length === 0) return last;
	return `${names.join(', ')} ${conjunction} ${last}`;
}
