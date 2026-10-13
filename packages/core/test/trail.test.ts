import { describe, expect, it } from 'vitest';
import { parseTrail, parseTrailAudiences, parseTrailGrade, sameTrail } from '../src/trail.ts';

describe('parseTrailGrade', () => {
	it('reads DNT’s four steps, whatever the case or spelling', () => {
		expect(parseTrailGrade('Enkel')).toBe('enkel');
		expect(parseTrailGrade(' Middels ')).toBe('middels');
		expect(parseTrailGrade('Krevende')).toBe('krevende');
		expect(parseTrailGrade('krevjande')).toBe('krevende');
		expect(parseTrailGrade('Ekspert')).toBe('ekspert');
	});

	it('is no grade at all for anything else', () => {
		for (const value of ['', null, undefined, 'Lett', 'Svært krevende']) {
			expect(parseTrailGrade(value), String(value)).toBeNull();
		}
	});
});

describe('parseTrailAudiences', () => {
	it('reads the comma list DNT writes, in the scale’s own order', () => {
		expect(parseTrailAudiences('Voksne, Seniorer')).toEqual(['vaksne', 'seniorar']);
		expect(parseTrailAudiences('Seniorer, Barn')).toEqual(['barn', 'seniorar']);
		expect(parseTrailAudiences('Funksjonshemmede')).toEqual(['tilrettelagt']);
	});

	it('drops a group it has no word for, and never repeats one', () => {
		expect(parseTrailAudiences('Seniorer, Hundeeigarar, seniorer')).toEqual(['seniorar']);
		expect(parseTrailAudiences(null)).toEqual([]);
	});
});

describe('parseTrail', () => {
	it('is null rather than an empty object when the source says nothing', () => {
		expect(parseTrail(null, null)).toBeNull();
		expect(parseTrail('', ' , ')).toBeNull();
	});

	it('keeps whichever half it was given', () => {
		expect(parseTrail('Middels', null)).toEqual({ grade: 'middels', audiences: [] });
		expect(parseTrail(null, 'Barn')).toEqual({ grade: null, audiences: ['barn'] });
	});
});

describe('sameTrail', () => {
	it('compares what the trail says, not how it was written down', () => {
		// The shape Postgres hands back from jsonb, keys in its own order.
		const stored = JSON.parse('{"audiences":["vaksne","seniorar"],"grade":"enkel"}');
		expect(sameTrail(stored, { grade: 'enkel', audiences: ['vaksne', 'seniorar'] })).toBe(true);
		expect(sameTrail(stored, { grade: 'middels', audiences: ['vaksne', 'seniorar'] })).toBe(false);
		expect(sameTrail(stored, { grade: 'enkel', audiences: ['vaksne'] })).toBe(false);
		expect(sameTrail(null, null)).toBe(true);
		expect(sameTrail(stored, null)).toBe(false);
	});
});
