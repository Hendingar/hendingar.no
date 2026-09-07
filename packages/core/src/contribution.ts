/**
 * Improving an event that is already here, rather than refusing the person who tried.
 *
 * The duplicate check answers "do we have this?" and, until now, that answer ended the
 * conversation. A submission that matched an existing event was `duplicate` — kept, credited to
 * nobody, and shown to its sender as a refusal — and a submission that merely *resembled* one was
 * `declined`, because `duplicate` is a blocking check and `uncertain` is not a pass. Both left the
 * sender with two routes: edit the title until it stops matching, which publishes a second row and
 * is a lie, or let the submission expire and lose whatever they brought with it.
 *
 * What they brought is the point. An importer copies what a calendar publishes, and Norwegian event
 * calendars publish thin: `importers/mec` files every event as `anna` because guessing would be
 * inventing a fact, half the rows carry no poster, and a row imported from a venue's programme has
 * exactly one citation — the venue's own. A person who photographed the poster off a noticeboard
 * and pasted the Facebook link is holding precisely what the row lacks.
 *
 * So a matching submission becomes a **contribution**: it fills the canonical row's gaps and is
 * recorded as another report of the same event. Nothing is republished and no second row appears in
 * any listing.
 *
 * ## Gaps only, and never an overwrite
 *
 * A contribution is authorised by `submitterClientId` — a random value the browser keeps in
 * localStorage, which `schema.ts` is explicit about: "not a credential and must never gate anything
 * that matters more than this", where *this* was somebody's own unpublished draft. A live listing
 * matters more. Editing one on a bearer token is not something this rule is allowed to permit.
 *
 * Gap-filling is what makes it safe, because it is monotone. A field that holds something keeps it.
 * The worst a bad actor achieves is a wrong poster on an event that had none — visible on the page,
 * attributed to a client id in `event_contributions`, and revertable by setting one column back to
 * null. An overwrite rule would let the same actor change text a reader is relying on, and would
 * need every previous value stored to be undoable at all.
 *
 * That is deliberately conservative in one place worth naming: a hotlinked poster with
 * `posterRightsVerified` false is NOT treated as a gap, even though a contributor's own photograph
 * is a stronger claim than a hotlink (see the note in `routes/ko/[id]/bilete`). Allowing that swap
 * is a defensible next step; it is an overwrite, so it is not this one.
 *
 * Pure, and here rather than in the remote function that needed it first (CLAUDE.md rule 1): the
 * submission path, the queue's "what would this add?" preview and the tests all have to agree about
 * what a gap is, and a second copy of the rule is how the preview starts promising a fill that the
 * write then declines to make.
 */

/**
 * The fields a contribution may fill.
 *
 * Every one of them is something a reader gains and nobody loses: a picture on a card that had a
 * generated tile, a second citation, a ticket link, an end time, the name of whoever is putting it
 * on. None of them changes what event the row *is*.
 */
export const CONTRIBUTABLE_FIELDS = [
	'posterUrl',
	'sourceUrl',
	'ctaUrl',
	'description',
	'endsAt',
	'organizerName'
] as const;

export type ContributableField = (typeof CONTRIBUTABLE_FIELDS)[number];

/**
 * The fields a contribution may never touch, and the reason it may not.
 *
 * These four are the event's identity: together they are what `comparePair` compares and what a
 * reader followed a link to find. Letting a contribution change them would make "improve this
 * event" a way to point somebody else's URL at a different event entirely — which is the one thing
 * a browser-local id must not be able to do.
 *
 * A list rather than a comment, because it is asserted: a field cannot be both contributable and
 * identity, and the test says so. Adding a sixth contributable field means deciding which of the
 * two lists it belongs in, and the compiler is not able to ask that question on its own.
 */
export const IDENTITY_FIELDS = ['title', 'startsAt', 'category', 'venueName'] as const;

export type IdentityField = (typeof IDENTITY_FIELDS)[number];

/**
 * How alike two titles must be before we *offer* one as an event to improve.
 *
 * Below `DUPLICATE_TITLE_THRESHOLD` (0.7), and deliberately: that number decides what a reader
 * sees, so it is set where a false merge cannot happen. This number decides what a person is
 * *asked about*, and the asymmetry runs the other way — the cost of offering a wrong match is that
 * they say no, and the cost of not offering the right one is the whole dead end this replaces.
 *
 * `similarity.ts` already draws that distinction for the verifier's shortlist: "that one only has
 * to be good enough for a human to look at". This is the same job on the same side of the line.
 *
 * 0.5 is where the pipeline already reports a resemblance — `check_duplicate` in
 * services/verifier returns `uncertain` at 0.5 on a cruder measure. So the offer covers exactly the
 * submissions that were being told "liknar på «X»" with nothing they could do about it.
 */
export const CONTRIBUTION_SUGGESTION_THRESHOLD = 0.5;

/**
 * Is this string one of the fields we know?
 *
 * `event_contributions.field` is `text`, not an enum, because the set is a TypeScript fact and the
 * database has no business ruling on it — but that means a row read back is a `string`, and the
 * label maps are keyed by the union. This is the narrowing, and it is a real filter rather than a
 * formality: a row written by an older revision naming a field this one has dropped should
 * disappear from the credit list, not crash the page rendering it (CLAUDE.md rule 4 — the cast it
 * replaces would have done exactly that).
 */
export function isContributableField(value: string): value is ContributableField {
	return (CONTRIBUTABLE_FIELDS as readonly string[]).includes(value);
}

/** What each field is called where a contributor reads it. Nynorsk, as everything shown is. */
export const CONTRIBUTABLE_FIELD_LABELS: Record<ContributableField, string> = {
	posterUrl: 'bilete',
	sourceUrl: 'kjeldelenkje',
	ctaUrl: 'billettlenkje',
	description: 'skildring',
	endsAt: 'sluttid',
	organizerName: 'arrangør'
};

/**
 * A value a contribution can carry.
 *
 * `endsAt` is an instant and the rest are text, so both are admitted here rather than widened to
 * `unknown` — which would need a cast at every call site to be read back (CLAUDE.md rule 4).
 */
export type ContributableValue = string | Date | null | undefined;

export type ContributableFields = Readonly<Partial<Record<ContributableField, ContributableValue>>>;

/**
 * Is there something here?
 *
 * Whitespace is not, and neither is an empty string — a form posts `''` for every field nobody
 * filled in, so treating that as a value would make an untouched box look like a contribution and
 * an existing gap look filled. An unparseable Date is not either: `new Date('')` is a Date object
 * and holds nothing.
 */
export function hasValue(value: ContributableValue): boolean {
	if (value === null || value === undefined) return false;
	if (value instanceof Date) return !Number.isNaN(value.getTime());
	return value.trim().length > 0;
}

export type ContributionPlan = {
	/** Offered, and the canonical row has a gap there. These are the writes. */
	readonly fill: readonly ContributableField[];
	/**
	 * Offered, but the canonical row already holds something.
	 *
	 * Recorded rather than dropped. It is not a write, but it IS evidence — that somebody had this
	 * fact independently, and that the row already agreed with them. Corroboration is one of the
	 * five checks, and this is the only place a second, unprompted human account of a live event is
	 * ever written down.
	 */
	readonly redundant: readonly ContributableField[];
	/**
	 * Everything the canonical row lacks, whether or not this contribution offers it.
	 *
	 * What the invitation is built from: "denne manglar bilete og billettlenkje" is a specific ask,
	 * and "hjelp oss gjere henne betre" is not.
	 */
	readonly gaps: readonly ContributableField[];
};

/**
 * What would this contribution actually change?
 *
 * Both arguments are the same shape on purpose — the canonical row's current values, and the ones
 * being offered — so the rule reads as the comparison it is, and neither side can be passed in the
 * other's place without the field names disagreeing.
 */
export function planContribution(
	canonical: ContributableFields,
	offered: ContributableFields
): ContributionPlan {
	const fill: ContributableField[] = [];
	const redundant: ContributableField[] = [];
	const gaps: ContributableField[] = [];

	for (const field of CONTRIBUTABLE_FIELDS) {
		const held = hasValue(canonical[field]);
		if (!held) gaps.push(field);
		if (!hasValue(offered[field])) continue;
		if (held) redundant.push(field);
		else fill.push(field);
	}

	return { fill, redundant, gaps };
}

/** Is there anything here for the canonical row at all? Drives whether the offer is made. */
export function isWorthContributing(plan: ContributionPlan): boolean {
	return plan.fill.length > 0;
}

/**
 * The gaps, as a sentence a contributor reads.
 *
 * Nynorsk list punctuation — "bilete, kjeldelenkje og skildring" — because a comma before the last
 * item is wrong in the language this site is written in, and this string is shown, not logged.
 */
export function describeFields(fields: readonly ContributableField[]): string {
	const labels = fields.map((field) => CONTRIBUTABLE_FIELD_LABELS[field]);
	if (labels.length === 0) return '';
	if (labels.length === 1) return labels[0]!;
	return `${labels.slice(0, -1).join(', ')} og ${labels[labels.length - 1]!}`;
}
