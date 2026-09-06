/**
 * The five checks, ordered for display.
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
