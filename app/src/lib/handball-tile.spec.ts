import { describe, expect, it } from 'vitest';
import { handballTitle, parseHandballMatch } from '@hendingar/core/handball';
import { TAG_Y, handballTile } from './handball-tile.ts';

const match = (away: string, team: 'menn' | 'kvinner' = 'menn') =>
	parseHandballMatch(handballTitle('Stord', away, team))!;

/** Every opponent in the committed 2026/2027 schedules, and one longer than any of them. */
const OPPONENTS = [
	'Ryger Stavanger',
	'BSI',
	'Fyllingen',
	'Ros',
	'Gneist',
	'Bækkelaget Spk',
	'Åsane 2',
	'Viking TIF 2',
	'Haslum IL',
	'Nordstrand 2',
	'Bjørnar',
	'Bergensdalen Idrettslag',
	'Bjørnar 2',
	'Bønes',
	'Lyngbø',
	'Fyllingen 2',
	'Florø',
	'Bjarg',
	'NHHI',
	'Sotra 2',
	'Bsi-Bergen Studentidrettslag Fotball og Friidrett'
];

describe('handballTile', () => {
	it('keeps every name below the tag and above the bottom frame', () => {
		for (const away of OPPONENTS) {
			const tile = handballTile(match(away));
			const first = tile.home.baselines[0]! - tile.home.fontSize * 0.74;
			const last = tile.away.baselines[tile.away.baselines.length - 1]!;
			expect(first, away).toBeGreaterThan(TAG_Y + 4);
			expect(last, away).toBeLessThanOrEqual(212);
		}
	});

	it('puts MOT between the two names', () => {
		for (const away of OPPONENTS) {
			const tile = handballTile(match(away));
			expect(tile.motY).toBeGreaterThan(tile.home.baselines.at(-1)!);
			expect(tile.motY).toBeLessThan(tile.away.baselines[0]! - tile.away.fontSize * 0.74);
		}
	});

	it('names the team and says it plainly to a screen reader', () => {
		const tile = handballTile(match('Bønes', 'kvinner'));
		expect(tile.tag).toBe('HANDBALL · KVINNER');
		expect(tile.label).toBe('Handballkamp: Stord mot Bønes, kvinner');
		expect(tile.home.lines).toEqual(['STORD']);
	});
});
