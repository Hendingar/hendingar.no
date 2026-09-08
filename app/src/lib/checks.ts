/**
 * The checks, ordered for display — and how many of them there are, spelled out.
 *
 * Derived, not retyped. Adding a check in core adds it to every place that renders the rail at
 * once; the landing page previously listed a "Geokoding" stage the pipeline never ran.
 *
 * This lives here rather than in `content/landing.ts` because it is no longer the landing page's
 * copy: `/send-inn` states the same five checks before you submit, and the verdict panel prints
 * them again afterwards. A shared thing owned by one route is how the event card came to be
 * written twice.
 */

import {
	VERIFICATION_CHECK_LABELS,
	VERIFICATION_CHECK_QUESTIONS,
	VERIFICATION_CHECKS
} from '@hendingar/core/verification';

export type PipelineStep = { readonly name: string; readonly what: string };

export const PIPELINE: readonly PipelineStep[] = VERIFICATION_CHECKS.map((check) => ({
	name: VERIFICATION_CHECK_LABELS[check],
	what: VERIFICATION_CHECK_QUESTIONS[check]
}));

/**
 * "seks" — the number of checks as a Nynorsk word, from the list itself.
 *
 * Six pieces of copy said "fem kontrollar" in their own words, on four routes, and every one of
 * them was wrong the moment `coverage` was added. The rail has always been derived; the sentence
 * next to it never was, so the page could name five checks directly above a list of six.
 *
 * A word rather than a digit because that is how the copy reads — "Seks kontrollar, ingen kø" — and
 * `{PIPELINE.length}` in a heading would be a design change smuggled in as a fix. The table stops
 * at twelve; past that a digit is the honest rendering anyway.
 */
const NYNORSK_NUMERALS = [
	'null',
	'ein',
	'to',
	'tre',
	'fire',
	'fem',
	'seks',
	'sju',
	'åtte',
	'ni',
	'ti',
	'elleve',
	'tolv'
] as const;

export const CHECK_COUNT_WORD: string =
	NYNORSK_NUMERALS[PIPELINE.length] ?? String(PIPELINE.length);

/** The same word where it opens a sentence. Nynorsk capitalises no differently; the copy does. */
export const CHECK_COUNT_WORD_LEADING: string =
	CHECK_COUNT_WORD.charAt(0).toUpperCase() + CHECK_COUNT_WORD.slice(1);
