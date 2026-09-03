/**
 * The verification checks — defined here and NOWHERE ELSE.
 *
 * The Postgres enum in schema.ts, the Zod enum in validation.ts and the UI labels all derive from
 * `VERIFICATION_CHECKS`. `services/verifier` implements the same five names in Python; that is the
 * one copy we cannot make the compiler enforce, so it is asserted in the service's tests instead.
 *
 * The split between rule and model is deliberate and is the thing we promise in the README: a
 * model is only asked the questions that need judgement. See
 * docs/decisions/0006-agentic-verification.md.
 */
export const VERIFICATION_CHECKS = [
	'plausibility',
	'duplicate',
	'normalisation',
	'categorisation',
	'corroboration'
] as const;

export type VerificationCheck = (typeof VERIFICATION_CHECKS)[number];

export const VERIFICATION_VERDICTS = ['pass', 'uncertain', 'fail'] as const;
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

/** Exhaustive by construction: a new check without a label is a compile error. */
export const VERIFICATION_CHECK_LABELS: Record<VerificationCheck, string> = {
	plausibility: 'Truverd',
	duplicate: 'Dublett',
	normalisation: 'Normalisering',
	categorisation: 'Kategori',
	corroboration: 'Kjelde'
};

/** What each check actually asks. Shown in the UI so a verdict is never an unexplained stamp. */
export const VERIFICATION_CHECK_QUESTIONS: Record<VerificationCheck, string> = {
	plausibility: 'Ser dette ut som ei ekte hending, ikkje spam eller tull?',
	duplicate: 'Finst hendinga i basen frå før?',
	normalisation: 'Er tid, stad og felt utfylte og i rett format?',
	categorisation: 'Passar kategorien til innhaldet?',
	corroboration: 'Kan hendinga stadfestast mot ei kjelde?'
};

export const VERIFICATION_VERDICT_LABELS: Record<VerificationVerdict, string> = {
	pass: 'Godkjend',
	uncertain: 'Usikker',
	fail: 'Stoppa'
};

/**
 * What a rejected submission is allowed to show in public.
 *
 * A rejected submission is retained rather than deleted — a wrong call stays recoverable and
 * repeat spam has something to match against — but its text is not republished, because
 * reprinting what we judged to be spam or abuse would defeat rejecting it.
 *
 * This is domain policy, not presentation, so it lives here rather than in the query that happens
 * to need it today (CLAUDE.md rule 1). Keeping it pure also means it is testable without a
 * database, which the e2e layer is not: the submission log is capped at five rows, so whether any
 * particular rejected row is on screen depends on what else was submitted first.
 */
export const WITHHELD_TITLE = 'Tilbakehalden tittel';

export function publicSubmissionTitle(status: string, title: string | null): string | null {
	return status === 'rejected' ? null : title;
}
