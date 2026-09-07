import { describe, expect, it } from 'vitest';
import {
	filterTokens,
	filtersFromParams,
	hiddenFilterFields,
	isUnfiltered,
	listingHref,
	withFilter
} from './listing-url.ts';

const labels = {
	category: (slug: string) => ({ musikk: 'Musikk', kyrkjeliv: 'Kyrkjeliv' })[slug] ?? slug,
	source: (slug: string) => ({ 'stord-kulturhus': 'Stord kulturhus' })[slug] ?? slug
};

describe('filtersFromParams', () => {
	it('reads the four axes', () => {
		const params = new URLSearchParams(
			'q=jazz&kategori=musikk&kjelde=stord-kulturhus&stad=Storsalen'
		);
		expect(filtersFromParams(params)).toEqual({
			q: 'jazz',
			kategori: 'musikk',
			kjelde: 'stord-kulturhus',
			stad: 'Storsalen'
		});
	});

	it('treats an empty or whitespace value as absent', () => {
		// `?q=` is what an empty search box submits, and it must mean "no search" rather than
		// "search for nothing" — otherwise pressing enter on an empty field looks like a filter.
		expect(filtersFromParams(new URLSearchParams('q=&kategori=%20'))).toEqual({});
	});

	it('ignores parameters that are not filters', () => {
		expect(filtersFromParams(new URLSearchParams('side=2&utm_source=fb'))).toEqual({});
	});
});

describe('listingHref', () => {
	it('is the bare path when nothing is filtered', () => {
		expect(listingHref({})).toBe('/hendingar');
	});

	it('keeps a stable key order, so identical filters are one URL and one cache entry', () => {
		const a = listingHref({ kategori: 'musikk', q: 'jazz' });
		const b = listingHref({ q: 'jazz', kategori: 'musikk' });
		expect(a).toBe(b);
		expect(a).toBe('/hendingar?q=jazz&kategori=musikk');
	});

	it('encodes spaces and anything else somebody types', () => {
		expect(listingHref({ stad: 'Stord kulturhus' })).toBe('/hendingar?stad=Stord%20kulturhus');
		expect(listingHref({ q: 'jazz & blues' })).toBe('/hendingar?q=jazz%20%26%20blues');
	});
});

describe('withFilter', () => {
	it('adds without touching the rest', () => {
		expect(withFilter({ q: 'jazz' }, 'kategori', 'musikk')).toEqual({
			q: 'jazz',
			kategori: 'musikk'
		});
	});

	it('removes on null, and on an empty string', () => {
		expect(withFilter({ q: 'jazz', kategori: 'musikk' }, 'kategori', null)).toEqual({ q: 'jazz' });
		expect(withFilter({ q: 'jazz' }, 'q', '')).toEqual({});
	});

	it('does not mutate the filters it was given', () => {
		const before = { q: 'jazz' };
		withFilter(before, 'kategori', 'musikk');
		expect(before).toEqual({ q: 'jazz' });
	});
});

describe('filterTokens', () => {
	it('labels each token rather than showing its slug', () => {
		const tokens = filterTokens({ kategori: 'musikk', kjelde: 'stord-kulturhus' }, labels);
		expect(tokens.map((t) => t.label)).toEqual(['Musikk', 'Stord kulturhus']);
		expect(tokens.map((t) => t.kind)).toEqual(['Kategori', 'Kjelde']);
	});

	it('removes only its own axis and keeps the others', () => {
		/*
		 * The bug this prevents is the one the two-chip version had before `filterHref`: pressing a
		 * source chip silently dropped the category, so the list changed in two ways at once and
		 * nothing on screen explained why.
		 */
		const filters = { q: 'jul', kategori: 'musikk' as const, stad: 'Stord kyrkje' };
		const tokens = filterTokens(filters, labels);
		const stad = tokens.find((t) => t.key === 'stad')!;
		expect(stad.removeHref).toBe('/hendingar?q=jul&kategori=musikk');
	});

	it('does not make a token out of the free text', () => {
		// The query lives in the input itself, where it can be edited. A token for it would be a
		// second, read-only copy of something already on screen.
		expect(filterTokens({ q: 'jazz' }, labels)).toEqual([]);
	});
});

describe('hiddenFilterFields', () => {
	it('carries every filter except the one the visible input owns', () => {
		expect(hiddenFilterFields({ q: 'jazz', kategori: 'musikk', stad: 'Storsalen' })).toEqual([
			{ name: 'kategori', value: 'musikk' },
			{ name: 'stad', value: 'Storsalen' }
		]);
	});

	it('is empty when only the query is set', () => {
		expect(hiddenFilterFields({ q: 'jazz' })).toEqual([]);
	});
});

describe('isUnfiltered', () => {
	it('knows the plain listing from a filtered one', () => {
		expect(isUnfiltered({})).toBe(true);
		expect(isUnfiltered({ q: 'jazz' })).toBe(false);
	});
});
