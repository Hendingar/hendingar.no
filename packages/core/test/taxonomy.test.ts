import { describe, expect, it } from 'vitest';
import { CATEGORY_LABELS, CATEGORY_SLUGS, categoryLabel } from '../src/taxonomy.ts';

describe('taxonomy', () => {
	it('has a label for every slug', () => {
		for (const slug of CATEGORY_SLUGS) {
			expect(categoryLabel(slug)).toBeTruthy();
		}
	});

	it('has no labels for slugs that do not exist', () => {
		expect(Object.keys(CATEGORY_LABELS).sort()).toEqual([...CATEGORY_SLUGS].sort());
	});

	it('has unique slugs', () => {
		expect(new Set(CATEGORY_SLUGS).size).toBe(CATEGORY_SLUGS.length);
	});
});
