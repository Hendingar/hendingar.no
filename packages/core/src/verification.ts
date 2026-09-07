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

/**
 * What would actually fix each check, addressed to the one person who can.
 *
 * The questions above say what a check asks; these say what to do when it says no. That is a
 * different sentence and it belongs to the sender, not to the check: a queue that only reports
 * failures is a wall with a sign on it.
 *
 * Here rather than in the page that first needed them (CLAUDE.md rule 1). `/ko` had them inline,
 * and the submission form now needs the same words next to the fields they are about — two copies
 * of remedial copy drift, and the version somebody reads while correcting their event is the one
 * that has to be right.
 */
export const VERIFICATION_CHECK_HINTS: Record<VerificationCheck, string> = {
	plausibility:
		'Legg til ei lenkje til arrangøren og fyll ut skildringa, så har kontrollen noko å gå på.',
	/*
	 * Two answers now, and the second one is the useful one.
	 *
	 * This used to name only the route that assumes we are wrong — "check whether it is a different
	 * event" — which left the person who agrees with the check holding a poster and a source link
	 * with nowhere to put them. That is the commoner case, so it is stated first.
	 */
	duplicate:
		'Er det den same, kan du gjere den hendinga betre med det du sende. Er det ei anna, rett tittel, dato eller stad så det syner.',
	normalisation: 'Sjekk dato, klokkeslett og stad.',
	categorisation: 'Prøv ein annan kategori.',
	corroboration:
		'Ei lenkje til arrangøren eller Facebook-hendinga gjer denne sterkare — men ho stoppar deg ikkje.'
};

/**
 * Which fields on the submission form each check actually reads.
 *
 * So a form opened to correct a submission can put the failing check *at the field*, rather than
 * printing five verdicts at the top and leaving somebody to work out which box to touch. "Kategori:
 * usikker" above a form of eleven inputs is a diagnosis; the same words beside the category select
 * are an instruction.
 *
 * Domain knowledge, not presentation: which field a check reads is a fact about the check, and the
 * verifier is what makes it true. Kept next to the checks themselves so a sixth one cannot be added
 * without deciding what a sender would change — the compiler asks.
 *
 * `duplicate` names the fields that decide whether two events are the same one (see
 * `similarity.ts`), which is what a sender would have to change to say "no, a different night".
 */
export const VERIFICATION_CHECK_FIELDS: Record<VerificationCheck, readonly string[]> = {
	plausibility: ['title', 'description', 'sourceUrl'],
	duplicate: ['title', 'date', 'startTime', 'venueName'],
	normalisation: ['date', 'startTime', 'endTime', 'venueName', 'municipality'],
	categorisation: ['category'],
	corroboration: ['sourceUrl']
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
