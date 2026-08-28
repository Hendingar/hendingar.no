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

export const DOES: readonly string[] = [
	'Éi søkbar, geotagga liste i staden for tolv silo-ar.',
	'Kven som helst kan leggje inn ei hending. Ingen konto.',
	'Kart, så du ser kva som skjer nær deg.',
	'RSS og iCal per stad — kalenderen din er ein førsteklasses klient.',
	'Data i EU. GDPR ved arkitektur, ikkje ved personvernerklæring.'
];

export const DOES_NOT: readonly Claim[] = [
	{ term: 'Billettar', body: 'Ingen kasse, ingen gebyr. Lenkje til der billettane faktisk finst.' },
	{
		term: 'Sosialt nettverk',
		body: 'Ingen følgjarar, ingen feed, ingen varsel som dreg deg tilbake.'
	},
	{ term: 'Reklame', body: 'Ingen annonsar, ingen sporing, ingen datasal. Aldri.' },
	{ term: 'Innhegning', body: 'Konto er frivillig. Alt kan eksporterast. Å gå er lett med vilje.' }
];

/**
 * Derived, not retyped. Adding a check in core adds it here and to the verdict panel at once;
 * previously the landing page listed a "Geokoding" stage the pipeline never ran.
 */
export const PIPELINE: readonly PipelineStep[] = VERIFICATION_CHECKS.map((check) => ({
	name: VERIFICATION_CHECK_LABELS[check],
	what: VERIFICATION_CHECK_QUESTIONS[check]
}));
