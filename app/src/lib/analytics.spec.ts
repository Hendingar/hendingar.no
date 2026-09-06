import { describe, expect, it } from 'vitest';
import { shouldTrack, surfaceOf } from './analytics.ts';

describe('shouldTrack', () => {
	it('reports from the live site', () => {
		expect(shouldTrack('hendingar.no')).toBe(true);
		expect(shouldTrack('www.hendingar.no')).toBe(true);
	});

	it('reports nothing from a development or test host', () => {
		/*
		 * The reason this is a function rather than a build flag. Ninety-odd end-to-end tests, every
		 * `pnpm dev` and every preview server would otherwise report page views, and the numbers
		 * would answer a different question from the one they are for.
		 */
		for (const host of [
			'localhost',
			'127.0.0.1',
			'dev.hendingar.no',
			'hendingar.no.evil.example'
		]) {
			expect(shouldTrack(host), host).toBe(false);
		}
	});

	it('is an exact host match, not a suffix one', () => {
		// `endsWith('hendingar.no')` would happily report from an attacker's lookalike domain.
		expect(shouldTrack('nothendingar.no')).toBe(false);
	});
});

describe('surfaceOf', () => {
	it('names the listing a tile was clicked from', () => {
		expect(surfaceOf('/')).toBe('framsida');
		expect(surfaceOf('/hendingar')).toBe('hendingar');
		expect(surfaceOf('/poppis/vist')).toBe('poppis');
	});

	it('is coarse on purpose', () => {
		// Which day somebody browsed is not a question we are asking, so the date does not travel.
		expect(surfaceOf('/kalender/2026-09-12')).toBe('kalender');
		expect(surfaceOf('/kalender')).toBe('kalender');
	});

	it('never invents a name for a page that is not a listing', () => {
		expect(surfaceOf('/send-inn')).toBe('anna');
		expect(surfaceOf('/hending/12-konsert')).toBe('anna');
		expect(surfaceOf('')).toBe('anna');
	});
});
