import { describe, expect, it } from 'vitest';
import { fromLine, fromParts, titleCasePlace } from '../src/address.ts';

/**
 * Every value below is real, lifted from a committed importer fixture.
 *
 * The bias under test is that no address beats the wrong address. A geocoder was tried first and
 * is what taught us that: Kartverket's place-name register resolved "Øklandstunet" to
 * Øklandsvatnet, which is a lake.
 */
describe('fromParts', () => {
	it('takes a source at its word when it keeps the fields apart', () => {
		expect(fromParts('Skuleplassvegen 1', '5443', 'FINNÅS')).toEqual({
			street: 'Skuleplassvegen 1',
			postalCode: '5443',
			city: 'Finnås'
		});
	});

	it('refuses a room name in a street field', () => {
		// HVL puts "Kulturhuset i Vaskerelven" in a field called `adress`. It is a room. Publishing
		// it as `streetAddress` would assert a street that does not exist anywhere.
		expect(fromParts('Kulturhuset i Vaskerelven', null, null).street).toBeNull();
		expect(fromParts('Baroniet Rosendal', null, null).street).toBeNull();
	});

	it('refuses a postnummer that is not four digits', () => {
		for (const bad of ['543', '54430', '5443 Finnås', 'N-5443', '']) {
			expect(fromParts('Vegen 1', bad, null).postalCode, bad).toBeNull();
		}
	});
});

describe('fromLine', () => {
	it('splits allevents.in’s single line into its parts', () => {
		expect(fromLine('Sagvågsbrekko 7, 5410 Sagvåg, Norge')).toEqual({
			street: 'Sagvågsbrekko 7',
			postalCode: '5410',
			city: 'Sagvåg'
		});
	});

	it('finds the street even when the venue’s name comes first', () => {
		// The same source writes it both ways. Insisting on the first segment threw this one away.
		expect(fromLine('Stord Hotell, Kjøtteinsvegen 66, 5411 Leirvik, Norge')).toEqual({
			street: 'Kjøtteinsvegen 66',
			postalCode: '5411',
			city: 'Leirvik'
		});
	});

	it('keeps the street and drops what it cannot name', () => {
		// "Stord Island, Hordaland, Norway" is a county and a country and a thing that is not an
		// island. A segment we cannot name is not a field we should fill.
		expect(fromLine('Kjøtteinsvegen 67,Stord Island, Hordaland, Norway')).toEqual({
			street: 'Kjøtteinsvegen 67',
			postalCode: null,
			city: null
		});
	});

	it('returns nothing when no segment is an address', () => {
		for (const line of ['Baroniet Rosendal', 'Berget, Noreg', '', null, undefined]) {
			expect(fromLine(line), String(line)).toEqual({
				street: null,
				postalCode: null,
				city: null
			});
		}
	});
});

describe('titleCasePlace', () => {
	it('calms a shouted place name without touching a considered one', () => {
		expect(titleCasePlace('FINNÅS')).toBe('Finnås');
		expect(titleCasePlace('stord')).toBe('Stord');
		// Already mixed case: somebody chose that, and it is not ours to normalise.
		expect(titleCasePlace('Bremnes')).toBe('Bremnes');
		expect(titleCasePlace('McDonald')).toBe('McDonald');
	});
});
