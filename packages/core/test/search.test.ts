import { describe, expect, it } from 'vitest';
import {
	SEARCH_MAX_LENGTH,
	SEARCH_MAX_TOKENS,
	dropFirstToken,
	hasSearch,
	likePattern,
	searchTermSchema,
	searchTokens
} from '../src/search.ts';

describe('searchTermSchema', () => {
	it('trims and collapses whitespace so one query is one query', () => {
		expect(searchTermSchema.parse('  jazz    stord  ')).toBe('jazz stord');
	});

	it('caps the term rather than refusing it', () => {
		/*
		 * Refusing would turn a long paste into an error page. Truncating searches for the first
		 * eighty characters, which is a reasonable reading of what was meant.
		 */
		const long = 'a'.repeat(SEARCH_MAX_LENGTH + 40);
		expect(searchTermSchema.parse(long)).toHaveLength(SEARCH_MAX_LENGTH);
	});

	it('rejects a paste far beyond any real query', () => {
		expect(() => searchTermSchema.parse('x'.repeat(SEARCH_MAX_LENGTH * 2 + 1))).toThrow();
	});
});

describe('searchTokens', () => {
	it('splits on whitespace', () => {
		expect(searchTokens('jazz stord')).toEqual(['jazz', 'stord']);
	});

	it('is empty for an empty query, so the caller can tell "no search" from "no results"', () => {
		expect(searchTokens('   ')).toEqual([]);
	});

	it('caps the number of tokens', () => {
		const many = Array.from({ length: SEARCH_MAX_TOKENS + 4 }, (_, i) => `t${i}`).join(' ');
		expect(searchTokens(many)).toHaveLength(SEARCH_MAX_TOKENS);
	});
});

describe('likePattern', () => {
	it('wraps the token so it matches anywhere in the field', () => {
		expect(likePattern('kyrkje')).toBe('%kyrkje%');
	});

	it('escapes the wildcards, so a percent sign searches for a percent sign', () => {
		/*
		 * The failure this prevents is not an injection — the value is bound — it is a search for
		 * "50%" quietly becoming "50 followed by anything", and a search for "%" matching the whole
		 * database. Both read as a broken feature rather than as an unlucky query.
		 */
		expect(likePattern('50%')).toBe('%50\\%%');
		expect(likePattern('a_b')).toBe('%a\\_b%');
	});

	it('escapes the backslash first, so the escapes cannot escape each other', () => {
		expect(likePattern('a\\b')).toBe('%a\\\\b%');
		expect(likePattern('\\%')).toBe('%\\\\\\%%');
	});
});

describe('dropFirstToken', () => {
	it('leaves the rest of the query behind when a suggestion is accepted', () => {
		expect(dropFirstToken('bremnes jul')).toBe('jul');
	});

	it('empties a one-word query', () => {
		expect(dropFirstToken('bremnes')).toBe('');
		expect(dropFirstToken('')).toBe('');
	});

	it('normalises what it returns, so the next search is the same shape as the first', () => {
		expect(dropFirstToken('  bremnes   jul  konsert ')).toBe('jul konsert');
	});
});

describe('hasSearch', () => {
	it('treats a single letter as a search — å is a place name', () => {
		expect(hasSearch('å')).toBe(true);
	});

	it('is false for nothing, whitespace, and the absent case', () => {
		expect(hasSearch('')).toBe(false);
		expect(hasSearch('   ')).toBe(false);
		expect(hasSearch(undefined)).toBe(false);
		expect(hasSearch(null)).toBe(false);
	});
});
