/**
 * How alike are two event titles?
 *
 * The same event reaches us from several places. A tourism board, a venue's own programme and a
 * newspaper's calendar all list the same concert, and none of them spells it identically:
 *
 *   "Audun Myskja: Hjarte mitt har ikkje demens"          (newspaper)
 *   "Audun Myskja: Hjartet mitt har ikkje demens"         (venue)      — one letter
 *   "Bård Tufte Johansen - Prøver å være positiv"         (newspaper)
 *   "Bård Tufte Johansen - Prøver å være positiv (18 år)" (venue)      — a suffix
 *   "Ekstra! Bård Tufte Johansen - Prøver å være positiv" (newspaper)  — a prefix
 *
 * Deterministic and cheap on purpose. A model is not needed to notice two strings are nearly the
 * same, and using one here would make a decision we take hundreds of times a day expensive,
 * unrepeatable and impossible to explain to whoever asks why two events merged.
 *
 * `services/verifier` has a Jaccard version of this for shortlisting a submission against
 * candidates. That one only has to be good enough for a human to look at; this one changes what a
 * reader sees, so it uses both signals.
 */

/** Lowercase, fold Norwegian letters, drop punctuation, collapse whitespace. */
export function normaliseTitle(value: string): string {
	return value
		.toLowerCase()
		.replace(/æ/g, 'ae')
		.replace(/ø/g, 'oe')
		.replace(/å/g, 'aa')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/**
 * Levenshtein distance, two rows rather than a full matrix.
 *
 * Titles are short, but this runs across every candidate pair in a time window, so the allocation
 * matters more than the elegance.
 */
export function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	let current = new Array<number>(b.length + 1);

	for (let i = 1; i <= a.length; i += 1) {
		current[0] = i;
		for (let j = 1; j <= b.length; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
		}
		[previous, current] = [current, previous];
	}
	return previous[b.length]!;
}

/** 1 for identical, 0 for nothing in common. */
export function levenshteinRatio(a: string, b: string): number {
	const longest = Math.max(a.length, b.length);
	if (longest === 0) return 1;
	return 1 - levenshtein(a, b) / longest;
}

/** Token overlap. Survives reordering and extra words, which edit distance punishes. */
export function jaccard(a: string, b: string): number {
	const left = new Set(a.split(' ').filter(Boolean));
	const right = new Set(b.split(' ').filter(Boolean));
	if (left.size === 0 || right.size === 0) return 0;
	let shared = 0;
	for (const token of left) if (right.has(token)) shared += 1;
	return shared / (left.size + right.size - shared);
}

/**
 * The score the consolidation uses: the better of the two signals.
 *
 * They fail in opposite directions, which is why both are here. Edit distance is blind to word
 * order and punishes an added parenthetical; token overlap treats "Hjarte" and "Hjartet" as
 * completely different words. Taking the max means a pair only has to be convincing one way.
 */
export function titleSimilarity(a: string, b: string): number {
	const left = normaliseTitle(a);
	const right = normaliseTitle(b);
	if (!left || !right) return 0;
	if (left === right) return 1;

	/*
	 * One title containing the other is the commonest cross-source shape: a venue adds "(18 år)", a
	 * newspaper prefixes "Ekstra!". Edit distance alone scores a long addition harshly even when
	 * the shorter title survives intact, so containment is scored on the part that matched.
	 */
	const contained =
		left.includes(right) || right.includes(left)
			? Math.min(left.length, right.length) / Math.max(left.length, right.length)
			: 0;

	return Math.max(levenshteinRatio(left, right), jaccard(left, right), contained);
}

/**
 * How alike are two *venue* names? Not the same question as two titles.
 *
 * `titleSimilarity` was used here too, and it is the wrong instrument. Edit distance is what makes
 * it good at titles — "Hjarte" and "Hjartet" are one keystroke apart and mean the same show — but
 * venue names in this region are a distinctive word plus a shared generic one, and edit distance
 * scores the generic word as agreement:
 *
 *   Nysæter kyrkje  / Moster kyrkje     levenshtein 0.60   token overlap 0.33   DIFFERENT churches
 *   Bremnes kyrkje  / Moster kyrkje     levenshtein 0.57   token overlap 0.33   DIFFERENT churches
 *   Stord Kyrkje    / Bømlo kyrkje      levenshtein 0.54   token overlap 0.33   DIFFERENT churches
 *
 * That first row is not hypothetical. Measured on the live database, `Nysæter kyrkje` and
 * `Moster kyrkje` cleared VENUE_MISMATCH_THRESHOLD by a hundredth, and three groups of Christmas
 * and Sunday services in two different parishes were merged into one row each — the exact false
 * merge `TITLE_DISTINCTIVE_TOKENS` exists to prevent, arriving through the check meant to catch
 * it. Six real services were hidden from the site by it.
 *
 * Dropping edit distance moves all three pairs to 0.33, a third of the threshold rather than a
 * hundredth over it, and costs nothing that was working: what venue names actually vary by is case
 * (`Stord kulturhus` / `Stord Kulturhus`, folded away by `normaliseTitle`) and extra words
 * (`Bømlo Folkebibliotek` / `Bømlo folkebibliotek -Bremnes`, 0.67 on token overlap). A room called
 * something else entirely is not a spelling problem and is not solved by any string rule — see
 * `venue-aliases.ts`.
 */
export function venueSimilarity(a: string, b: string): number {
	const left = normaliseTitle(a);
	const right = normaliseTitle(b);
	if (!left || !right) return 0;
	if (left === right) return 1;
	return jaccard(left, right);
}

/**
 * The score at which two events from different sources are the same event.
 *
 * Fitted to real pairs rather than chosen: the worst true duplicate observed scores 0.76 and the
 * closest genuinely-different pair scores 0.57, so this sits in the gap with room on both sides. A
 * threshold squeezed between them would be fitted to those ten pairs and nothing else.
 */
export const DUPLICATE_TITLE_THRESHOLD = 0.7;
