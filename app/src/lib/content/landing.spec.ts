import { describe, expect, it } from 'vitest';
import { MANIFEST } from './landing.ts';

/**
 * The pipeline's README-parity test used to live here. The five checks are no longer landing copy
 * — they are shared with /send-inn — so that test moved to `lib/checks.spec.ts` with the data.
 */
describe('landing content', () => {
	it('has exactly three manifest claims, since the band is a fixed three-row layout', () => {
		expect(MANIFEST.length).toBe(3);
	});
});
