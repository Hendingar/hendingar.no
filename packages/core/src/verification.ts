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
