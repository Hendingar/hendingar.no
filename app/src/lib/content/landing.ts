/**
 * Landing page copy.
 *
 * Separated from layout so a typo fix doesn't mean touching layout code, and so each string has a
 * named slot instead of being `array[1]` of an anonymous tuple.
 *
 * `DOES_NOT` is the prose rendering of README.md#what-it-does-not-do.
 *
 * `PIPELINE` is no longer copy: the check names now key rows in `verifications` and drive the
 * verdict panel on /send-inn, so they are domain data and live in @hendingar/core (rule 1). This
 * file only orders them for the landing band.
 */

import {
	VERIFICATION_CHECK_LABELS,
	VERIFICATION_CHECK_QUESTIONS,
	VERIFICATION_CHECKS
} from '@hendingar/core/verification';

export type Claim = { readonly term: string; readonly body: string };
export type PipelineStep = { readonly name: string; readonly what: string };

export const MANIFEST: readonly string[] = [
	'Gratis for alltid',
	'Ingen reklame',
	'Data blir i Europa'
];

/**
 * What the site does TODAY. Present tense, and only things a visitor can actually do right now.
 *
 * This list used to promise a map, RSS and iCal, and call the listing searchable. None of the
 * three exists — the README files feeds under a later phase, and there is no map library in the
 * repo at all. Under a heading reading "Kva det gjer", that is the site misrepresenting itself in
 * the one section whose whole job is being clear about what we do. Anything not built yet belongs
 * in PLANNED, where it is labelled as a plan.
 */
export const DOES: readonly string[] = [
	'Hendingar frå fleire kalendrar samla i éi liste, sortert etter dag.',
	'Filtrer på kategori. Filteret er ei lenkje, så du kan dele eller bokmerke det.',
	'Kven som helst kan sende inn ei hending. Ingen konto, ingen innlogging.',
	'Kvar hending lenkjer til kjelda si. Vi er ein indeks, ikkje ein erstatning.',
	'Vi seier kvar tala kjem frå, og når vi henta dei sist.'
];

/**
 * Not built yet, and labelled as such.
 *
 * Keeping these visible is worth more than hiding them: they are the honest answer to "why can I
 * not see this on a map", and a reader can tell the difference between a plan and a promise when
 * we mark which is which.
 */
export const PLANNED: readonly string[] = [
	'Kart over hendingar nær deg.',
	'Fritekstsøk, ikkje berre kategoriar.',
	'RSS og iCal, så kalenderen din kan abonnere direkte.'
];

/**
 * Plain nouns a reader already knows.
 *
 * "Innhegning" was a metaphor about enclosure that nobody would search for, and the section was
 * headed "Nektar resten" — brand voice describing a refusal, where the useful thing is simply
 * saying what does not happen here.
 */
export const DOES_NOT: readonly Claim[] = [
	{
		term: 'Vi sel ikkje billettar',
		body: 'Ingen kasse og ingen gebyr. Vi lenkjer til der billettane faktisk finst.'
	},
	{
		term: 'Vi er ikkje eit sosialt nettverk',
		body: 'Ingen følgjarar, ingen feed, ingen varsel som skal dra deg tilbake hit.'
	},
	{
		term: 'Vi har ikkje reklame',
		body: 'Ingen annonsar, ingen sporing, og vi sel ikkje data om deg. Aldri.'
	},
	{
		term: 'Vi låser deg ikkje inne',
		body: 'Du treng ingen konto. Kjeldekoden er open, og du kan alltid gå til kjelda sjølv.'
	}
];

/**
 * Derived, not retyped. Adding a check in core adds it here and to the verdict panel at once;
 * previously the landing page listed a "Geokoding" stage the pipeline never ran.
 */
export const PIPELINE: readonly PipelineStep[] = VERIFICATION_CHECKS.map((check) => ({
	name: VERIFICATION_CHECK_LABELS[check],
	what: VERIFICATION_CHECK_QUESTIONS[check]
}));
