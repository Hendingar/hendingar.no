/**
 * What a trip says about itself: how hard it is, and who it is for.
 *
 * DNT grades every activity it publishes — `level: "Middels"` — and lists who it suits —
 * `targetGroups: "Voksne, Seniorer"`. Until this module both were read off the API and dropped,
 * which left a trip with no photo as a generated pattern that said nothing at all, when the feed
 * had told us the two things a walker most wants to know before reading a word.
 *
 * Here rather than in `importers/dnt` because the app draws from it too (rule 1): the card picks
 * its mountains from the grade, and both the card and the event page name the audiences. One
 * vocabulary, so a label cannot drift between the importer that wrote it and the tile that reads it.
 *
 * ## The grades are DNT's, not ours
 *
 * Enkel, Middels, Krevende, Ekspert is DNT's own four-step scale, and each has a colour every
 * Norwegian walker already knows from the trail signs: green, blue, red, black. We keep the scale
 * exactly rather than mapping it onto something of our own, because a "Middels" that we redrew as
 * "medium" would be a second claim about the same trip.
 */

export const TRAIL_GRADES = ['enkel', 'middels', 'krevende', 'ekspert'] as const;
export type TrailGrade = (typeof TRAIL_GRADES)[number];

/** Nynorsk, as the rest of the site. DNT writes "Krevende"; a reader here reads "Krevjande". */
export const TRAIL_GRADE_LABELS: Record<TrailGrade, string> = {
	enkel: 'Enkel',
	middels: 'Middels',
	krevende: 'Krevjande',
	ekspert: 'Ekspert'
};

/**
 * Who it is for, as DNT names its target groups.
 *
 * Only the groups the feeds actually use, plus `ungdom`, which DNT's own filter offers. An
 * unknown group is dropped rather than stored: a label nobody has seen is a label no card can
 * draw, and the description still says it in the organiser's words.
 */
export const TRAIL_AUDIENCES = ['barn', 'ungdom', 'vaksne', 'seniorar', 'tilrettelagt'] as const;
export type TrailAudience = (typeof TRAIL_AUDIENCES)[number];

export const TRAIL_AUDIENCE_LABELS: Record<TrailAudience, string> = {
	barn: 'Barn',
	ungdom: 'Ungdom',
	vaksne: 'Vaksne',
	seniorar: 'Seniorar',
	/*
	 * DNT's word is "Funksjonshemmede". What it means on a trip is that the trip is arranged for
	 * people with a disability — which is what this says, about the trip rather than the walker.
	 */
	tilrettelagt: 'Tilrettelagt'
};

/** Stored on `events.trail`. Null on the row, never an empty object, when the source says nothing. */
export type Trail = {
	grade: TrailGrade | null;
	audiences: TrailAudience[];
};

const GRADE_WORDS: Readonly<Record<string, TrailGrade>> = {
	enkel: 'enkel',
	middels: 'middels',
	krevende: 'krevende',
	krevjande: 'krevende',
	ekspert: 'ekspert'
};

const AUDIENCE_WORDS: Readonly<Record<string, TrailAudience>> = {
	barn: 'barn',
	ungdom: 'ungdom',
	voksne: 'vaksne',
	vaksne: 'vaksne',
	seniorer: 'seniorar',
	seniorar: 'seniorar',
	funksjonshemmede: 'tilrettelagt',
	funksjonshemma: 'tilrettelagt'
};

/** "Middels" → `middels`. Anything else, including an empty string, is no grade. */
export function parseTrailGrade(level: string | null | undefined): TrailGrade | null {
	return GRADE_WORDS[(level ?? '').trim().toLowerCase()] ?? null;
}

/** "Voksne, Seniorer" → `['vaksne', 'seniorar']`, in the scale's order and without repeats. */
export function parseTrailAudiences(groups: string | null | undefined): TrailAudience[] {
	const found = new Set(
		(groups ?? '')
			.split(',')
			.map((word) => AUDIENCE_WORDS[word.trim().toLowerCase()])
			.filter((audience): audience is TrailAudience => audience !== undefined)
	);
	return TRAIL_AUDIENCES.filter((audience) => found.has(audience));
}

/** Both at once, or null when the source told us neither — the row stays null, not `{}`. */
export function parseTrail(
	level: string | null | undefined,
	groups: string | null | undefined
): Trail | null {
	const grade = parseTrailGrade(level);
	const audiences = parseTrailAudiences(groups);
	return grade === null && audiences.length === 0 ? null : { grade, audiences };
}

/**
 * Whether two stored trails say the same thing.
 *
 * Compared field by field, never as JSON text: Postgres hands a `jsonb` object back with its keys
 * in its own order, so a string comparison would call every row "updated" on every run.
 */
export function sameTrail(a: Trail | null, b: Trail | null): boolean {
	if (a === null || b === null) return a === b;
	return (
		a.grade === b.grade &&
		a.audiences.length === b.audiences.length &&
		a.audiences.every((audience, i) => audience === b.audiences[i])
	);
}
