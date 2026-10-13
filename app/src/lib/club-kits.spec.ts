import { describe, expect, it } from 'vitest';
import { parseFixture } from '@hendingar/core/fixture';
import { kitClass } from './club-kits.ts';

describe('kitClass', () => {
	it('dresses a match in the home club’s colours, whichever way NFF writes the club', () => {
		expect(kitClass(parseFixture('Bremnes Menn Senior A - Varegg Menn Senior A'))).toBe(
			'kit--bremnes'
		);
		expect(kitClass(parseFixture('Bremnes Kvinner 1 - Førde'))).toBe('kit--bremnes');
		expect(kitClass(parseFixture('Stord Fotball Menn Senior A - Gneist Menn Senior A'))).toBe(
			'kit--stord'
		);
		expect(kitClass(parseFixture('Stord Fotball Kvinner Senior A - Bremnes Kvinner 1'))).toBe(
			'kit--stord'
		);
	});

	it('goes by the home side only', () => {
		// The visiting club's colours on the home ground's card would be the wrong club's card.
		expect(kitClass(parseFixture('Åsane Kvinner 2 - Bremnes Kvinner 1'))).toBeNull();
	});

	it('leaves everything else in navy and peach', () => {
		expect(kitClass(parseFixture('Fitjar Menn senior A - Stord Fotball Menn Senior A'))).toBeNull();
		expect(kitClass(parseFixture('Konsert med Koret Lyren'))).toBeNull();
		expect(kitClass(null)).toBeNull();
	});
});
