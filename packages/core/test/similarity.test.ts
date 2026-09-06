import { describe, expect, it } from 'vitest';
import {
	DUPLICATE_TITLE_THRESHOLD,
	jaccard,
	levenshtein,
	levenshteinRatio,
	normaliseTitle,
	titleSimilarity,
	venueSimilarity
} from '../src/similarity.ts';
import { VENUE_MISMATCH_THRESHOLD } from '../src/consolidate.ts';

/**
 * The cases are real.
 *
 * Every pair below was found by querying the live database for events at the same instant from
 * different sources, so the threshold is fitted to data rather than to intuition.
 */
const DUPLICATES: [string, string][] = [
	// One letter apart — a newspaper and the venue spelling the same talk differently.
	['Audun Myskja: Hjarte mitt har ikkje demens', 'Audun Myskja: Hjartet mitt har ikkje demens'],
	// The venue appends an age limit.
	[
		'Bård Tufte Johansen - Prøver å være positiv',
		'Bård Tufte Johansen - Prøver å være positiv (18 år)'
	],
	// The newspaper prefixes an extra-show marker.
	[
		'Ekstra! Bård Tufte Johansen - Prøver å være positiv (18 år)',
		'Bård Tufte Johansen - Prøver å være positiv (18 år)'
	],
	// A tourism board in English, the venue in Norwegian — the hardest real case.
	['Grand Kyiv Ballet: Swan Lake', 'Grand Kyiv Ballet - Svanesjøen']
];

const DISTINCT: [string, string][] = [
	['Songkveld i Stord kyrkje', 'Sjakk i biblioteket'],
	['Åpen gard og loppemarked', 'Offentleg symjing'],
	['Familiedag på museet', 'Offentleg symjing'],
	['Musikkbingo med Åge Stokken!', 'Kystsonglaget i Kulleseidkanalen gjestehamn'],
	// Close, and genuinely different: one of these has a baptism in it.
	['Gudstjeneste', 'Gudstjeneste med dåp']
];

describe('titleSimilarity', () => {
	it.each(DUPLICATES)('treats %s and %s as the same event', (a, b) => {
		expect(titleSimilarity(a, b)).toBeGreaterThanOrEqual(DUPLICATE_TITLE_THRESHOLD);
	});

	it.each(DISTINCT)('keeps %s and %s apart', (a, b) => {
		expect(titleSimilarity(a, b)).toBeLessThan(DUPLICATE_TITLE_THRESHOLD);
	});

	it('leaves a real gap between the two groups, not a hairline', () => {
		const worstDuplicate = Math.min(...DUPLICATES.map(([a, b]) => titleSimilarity(a, b)));
		const bestDistinct = Math.max(...DISTINCT.map(([a, b]) => titleSimilarity(a, b)));
		// A threshold wedged between 0.71 and 0.70 would be fitted to these ten pairs and nothing
		// else. The margin is what makes it likely to hold for the eleventh.
		expect(worstDuplicate - bestDistinct).toBeGreaterThan(0.15);
	});

	it('is symmetric, because merging must not depend on which row was read first', () => {
		for (const [a, b] of [...DUPLICATES, ...DISTINCT]) {
			expect(titleSimilarity(a, b)).toBeCloseTo(titleSimilarity(b, a), 10);
		}
	});

	it('scores identical titles 1, and that is why the same source is never a candidate', () => {
		// Two public-swimming sessions carry the same title and are different events. Title alone
		// can never decide this; only the rule that a source does not duplicate itself can.
		expect(titleSimilarity('Offentleg symjing', 'Offentleg symjing')).toBe(1);
	});

	it('is 0 when either title is empty', () => {
		expect(titleSimilarity('', 'Konsert')).toBe(0);
		expect(titleSimilarity('Konsert', '   ')).toBe(0);
	});
});

/**
 * Venue names, which are a different problem.
 *
 * These pairs are real too — every one is a venue name a source in this database actually writes.
 * The threshold they are measured against is `VENUE_MISMATCH_THRESHOLD`, 0.6.
 */
const SAME_PLACE: [string, string][] = [
	// Case, which is all that separates two calendars naming the same house.
	['Stord kulturhus', 'Stord Kulturhus'],
	// A branch qualifier appended by the source.
	['Bømlo Folkebibliotek', 'Bømlo folkebibliotek -Bremnes']
];

const DIFFERENT_PLACES: [string, string][] = [
	// Two parishes. The first pair is the one that was merging: 0.60 on edit distance.
	['Nysæter kyrkje', 'Moster kyrkje'],
	['Bremnes kyrkje', 'Moster kyrkje'],
	['Stord Kyrkje', 'Bømlo kyrkje'],
	['Stord Kyrkje', 'Bremnes kyrkje'],
	['Nysæter kyrkje', 'Bømlo kyrkje'],
	// A library and the house it stands in: near neighbours, still not interchangeable.
	['Stord bibliotek', 'Stord kulturhus'],
	['Stord vidaregåande skule', 'Stord kulturhus']
];

describe('venueSimilarity', () => {
	it.each(SAME_PLACE)('reads %s and %s as one place', (a, b) => {
		expect(venueSimilarity(a, b)).toBeGreaterThanOrEqual(VENUE_MISMATCH_THRESHOLD);
	});

	it.each(DIFFERENT_PLACES)('keeps %s and %s apart', (a, b) => {
		expect(venueSimilarity(a, b)).toBeLessThan(VENUE_MISMATCH_THRESHOLD);
	});

	it('leaves a real gap, where titleSimilarity left a hundredth', () => {
		/*
		 * The measurement that justifies a second function rather than reusing `titleSimilarity`.
		 * On edit distance the worst same-place pair and the closest different-place pair were
		 * 0.67 and 0.60 — seven hundredths apart, with the threshold inside the gap and a real
		 * false merge already through it. On token overlap they are 0.67 and 0.33.
		 */
		const worstSame = Math.min(...SAME_PLACE.map(([a, b]) => venueSimilarity(a, b)));
		const closestDifferent = Math.max(...DIFFERENT_PLACES.map(([a, b]) => venueSimilarity(a, b)));
		expect(worstSame - closestDifferent).toBeGreaterThan(0.25);
	});

	it('is exactly why titleSimilarity is the wrong instrument here', () => {
		// Kept as a measurement rather than a comment: edit distance calls these two churches a
		// match, and this line fails the day somebody points venue comparison back at it.
		expect(titleSimilarity('Nysæter kyrkje', 'Moster kyrkje')).toBeGreaterThanOrEqual(
			VENUE_MISMATCH_THRESHOLD
		);
		expect(venueSimilarity('Nysæter kyrkje', 'Moster kyrkje')).toBeLessThan(
			VENUE_MISMATCH_THRESHOLD
		);
	});

	it('is symmetric, because merging must not depend on which row was read first', () => {
		for (const [a, b] of [...SAME_PLACE, ...DIFFERENT_PLACES]) {
			expect(venueSimilarity(a, b)).toBeCloseTo(venueSimilarity(b, a), 10);
		}
	});

	it('is 0 when either name is empty', () => {
		expect(venueSimilarity('', 'Storsalen')).toBe(0);
		expect(venueSimilarity('Storsalen', '  ')).toBe(0);
	});
});

describe('normaliseTitle', () => {
	it('folds Norwegian letters so a spelling difference is not a word difference', () => {
		// æ/ø/å are folded to ae/oe/aa before NFD strips the rest, matching `slugifyVenue`
		// elsewhere in the repo. "baard" is not pretty; it is a comparison key, and being
		// consistent with the other folding matters more than looking like the word.
		expect(normaliseTitle('Bård Tufte Johansen — Prøver å være positiv!')).toBe(
			'baard tufte johansen proever aa vaere positiv'
		);
	});

	it('collapses punctuation and case', () => {
		expect(normaliseTitle('  KONSERT:  Salmar  på  Osvald ')).toBe('konsert salmar paa osvald');
	});
});

describe('levenshtein', () => {
	it('counts single edits', () => {
		expect(levenshtein('hjarte', 'hjartet')).toBe(1);
		expect(levenshtein('kitten', 'sitting')).toBe(3);
		expect(levenshtein('', 'abc')).toBe(3);
		expect(levenshtein('same', 'same')).toBe(0);
	});

	it('ratio is 1 for identical and 0 for nothing shared', () => {
		expect(levenshteinRatio('abc', 'abc')).toBe(1);
		expect(levenshteinRatio('', '')).toBe(1);
		expect(levenshteinRatio('abc', 'xyz')).toBe(0);
	});
});

describe('jaccard', () => {
	it('survives reordering, which edit distance punishes', () => {
		// The signal edit distance is blind to — and the reason both are used.
		expect(jaccard('konsert med bjoern berge', 'bjoern berge konsert med')).toBe(1);
		expect(levenshteinRatio('konsert med bjoern berge', 'bjoern berge konsert med')).toBeLessThan(
			0.6
		);
	});

	it('is 0 for no shared tokens', () => {
		expect(jaccard('a b', 'c d')).toBe(0);
	});
});
