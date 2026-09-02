import { describe, expect, it } from 'vitest';
import { eventIdFromParam, eventPath, slugify } from '../src/slug.ts';

describe('slugify', () => {
	it('folds Norwegian letters rather than dropping them', () => {
		// Stripping diacritics alone turns "Frøken" into "frken"; æ/ø/å need transliterating first.
		expect(slugify('Frøken Julie på Bømlo')).toBe('froeken-julie-paa-boemlo');
		expect(slugify('Sæterdagskveld')).toBe('saeterdagskveld');
	});

	it('collapses punctuation and trims the edges', () => {
		expect(slugify('  Quiz!! på "Kaikanten" — 2026  ')).toBe('quiz-paa-kaikanten-2026');
	});

	it('never ends in a separator, even when truncation lands on one', () => {
		const long = `${'a'.repeat(79)} b`;
		expect(slugify(long).endsWith('-')).toBe(false);
	});

	it('returns empty for input with nothing sluggable', () => {
		expect(slugify('!!! ???')).toBe('');
	});
});

describe('eventPath', () => {
	it('leads with the id so the slug is decoration', () => {
		expect(eventPath(123, 'Frøken Julie')).toBe('/hending/123-froeken-julie');
	});

	it('omits the slug when the title yields none', () => {
		expect(eventPath(7, '???')).toBe('/hending/7');
	});
});

describe('eventIdFromParam', () => {
	it('reads the id back out, ignoring the slug', () => {
		expect(eventIdFromParam('123-froeken-julie')).toBe(123);
		expect(eventIdFromParam('123')).toBe(123);
	});

	it('tolerates a stale or mangled slug, because the id is authoritative', () => {
		// The whole point of putting the id first: a retitled event never needs a redirect.
		expect(eventIdFromParam('123-heilt-anna-tittel')).toBe(123);
	});

	it('rejects anything not starting with a positive integer', () => {
		for (const bad of ['', 'abc', '-1', '0', 'x123', ' 12']) {
			expect(eventIdFromParam(bad), bad).toBeNull();
		}
	});
});
