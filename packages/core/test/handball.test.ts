import { describe, expect, it } from 'vitest';
import { parseFixture } from '../src/fixture.ts';
import { handballTitle, parseHandballMatch } from '../src/handball.ts';

describe('handballTitle', () => {
	it('names the sport, both sides and the team', () => {
		expect(handballTitle('Stord', 'Ros', 'menn')).toBe('Handball: Stord - Ros (menn)');
		expect(handballTitle('Stord', 'Bønes', 'kvinner')).toBe('Handball: Stord - Bønes (kvinner)');
	});

	it('closes up a separator inside a club name, so the title still splits in two', () => {
		// handball.no's own long name for BSI, which is how a second " - " would arrive.
		const title = handballTitle('Stord', 'Bsi - Bergen Studentidrettslag', 'menn');
		expect(title).toBe('Handball: Stord - Bsi-Bergen Studentidrettslag (menn)');
		expect(parseHandballMatch(title)?.away.club).toBe('Bsi-Bergen Studentidrettslag');
	});

	it('trims and collapses the padding handball.no leaves in short names', () => {
		expect(handballTitle('Stord', 'Bergensdalen ', 'kvinner')).toBe(
			'Handball: Stord - Bergensdalen (kvinner)'
		);
	});
});

describe('parseHandballMatch', () => {
	it('reads back what handballTitle wrote', () => {
		expect(parseHandballMatch(handballTitle('Stord', 'Viking TIF 2', 'menn'))).toEqual({
			sport: 'handball',
			team: 'menn',
			home: { club: 'Stord', grade: 'Menn' },
			away: { club: 'Viking TIF 2', grade: 'Menn' },
			grade: 'Menn'
		});
		expect(parseHandballMatch('Handball: Stord - Lyngbø (kvinner)')?.grade).toBe('Kvinner');
	});

	it('refuses anything it did not write', () => {
		for (const title of [
			null,
			'',
			'Stord Fotball Menn Senior A - Vard Haugesund',
			'Handball: Stord - Ros',
			'Handball: Stord (menn)',
			'Handball: Stord - Ros - Bjarg (menn)',
			'Konsert - Koret Lyren'
		]) {
			expect(parseHandballMatch(title)).toBeNull();
		}
	});

	it('is never also read as a football fixture', () => {
		// EventThumb asks handball first, but the two rules should not overlap in the first place.
		expect(parseFixture('Handball: Stord - Ros (menn)')).toBeNull();
		expect(parseFixture('Handball: Stord - Fyllingen 2 (kvinner)')).toBeNull();
	});
});
