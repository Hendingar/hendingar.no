import { describe, expect, it } from 'vitest';
import { canonicalUrl, SITE_ORIGIN } from './origin.ts';

const from = (origin: string) => ({ hostname: new URL(origin).hostname, origin });

describe('canonicalUrl', () => {
	it('collapses every live host onto the apex', () => {
		/*
		 * The bug this exists to prevent. `hendingar.no`, `www.hendingar.no` and `dev.hendingar.no`
		 * are all bound to the same container app, so before this each one told a crawler it was
		 * the original of the same page — one site indexed three times, competing with itself.
		 */
		for (const origin of ['https://hendingar.no', 'https://www.hendingar.no']) {
			expect(canonicalUrl(from(origin), '/hending/12-konsert')).toBe(
				`${SITE_ORIGIN}/hending/12-konsert`
			);
		}
	});

	it('leaves a development host alone', () => {
		/*
		 * A canonical pointing at production from a laptop is a lie that is hard to notice, and it
		 * would send the end-to-end suite asserting against the live site instead of its own.
		 */
		expect(canonicalUrl(from('http://localhost:5173'), '/hendingar')).toBe(
			'http://localhost:5173/hendingar'
		);
		expect(canonicalUrl(from('https://dev.hendingar.no'), '/hendingar')).toBe(
			'https://dev.hendingar.no/hendingar'
		);
	});

	it('keeps the query string a route chose to pass', () => {
		// `/kalender?maanad=` is a page of its own; whether a parameter belongs in the canonical is
		// the route's decision, so this must not strip one.
		expect(canonicalUrl(from('https://www.hendingar.no'), '/kalender?maanad=2026-10')).toBe(
			`${SITE_ORIGIN}/kalender?maanad=2026-10`
		);
	});

	it('is an exact host match, not a suffix one', () => {
		// A lookalike domain must not be able to borrow our canonical.
		expect(canonicalUrl(from('https://nothendingar.no'), '/')).toBe('https://nothendingar.no/');
	});
});
