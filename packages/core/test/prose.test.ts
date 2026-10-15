import { describe, expect, it } from 'vitest';
import { capitalise, listSentence } from '../src/prose.ts';

describe('listSentence', () => {
	it('joins with commas and puts the conjunction before the last item only', () => {
		expect(listSentence(['Stord', 'Bømlo', 'Fitjar'])).toBe('Stord, Bømlo og Fitjar');
		expect(listSentence(['Stord', 'Bømlo', 'Fitjar'], 'eller')).toBe('Stord, Bømlo eller Fitjar');
		expect(listSentence(['bilete', 'skildring'])).toBe('bilete og skildring');
	});

	it('leaves one item alone and gives nothing for none', () => {
		expect(listSentence(['Stord'])).toBe('Stord');
		expect(listSentence([])).toBe('');
	});
});

describe('capitalise', () => {
	it('upper-cases the first letter, including a Norwegian one', () => {
		expect(capitalise('måndag')).toBe('Måndag');
		expect(capitalise('')).toBe('');
	});
});
