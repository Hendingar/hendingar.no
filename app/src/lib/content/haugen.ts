/**
 * `/haugen` copy.
 *
 * The suggestions are what somebody would actually say out loud about an evening, not category
 * names — "noko som gjer deg sprek" rather than "Sport". A category is already a chip on
 * `/hendingar`; this page exists for the questions a category cannot answer.
 */

export const HAUGEN = {
	eyebrow: 'Haugen',
	heading: 'Høyr med haugen.',
	lede: (n: number) =>
		`${n} hendingar dei neste vekene, i ein haug. Sei kva du har lyst til å gjere.`,
	placeholder: 'Kva har du lyst til å gjere?',
	/** Shown when the answer came from plain text matching rather than from the ranker. */
	textOnly: 'Enkel tekstsøk akkurat no — haugen les berre orda, ikkje meininga.',
	none: 'Ingenting i haugen svarar på det. Prøv å seie det på ein annan måte.',
	answers: (n: number) => (n === 1 ? 'Eitt treff' : `${n} treff`)
} as const;

export const SUGGESTIONS: readonly string[] = [
	'konsertar',
	'noko for ungdom',
	'ting å gjere ute',
	'noko som gjer deg sprek',
	'for dei minste'
];
