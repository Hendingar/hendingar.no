import { describe, expect, it } from 'vitest';
import {
	COVERED_MUNICIPALITIES,
	COVERED_PLACES,
	classifyCoverage,
	coveredMunicipalitiesSentence,
	placeTokens
} from '../src/coverage.ts';

/**
 * The regression this module exists for is one submission: a concert by The Watch in Grieghallen,
 * Bergen, which passed every check and went live. So the first test is that exact input, and the
 * rest are the ways a rule this blunt could refuse a local event instead — which is the failure
 * that would matter more, because the person it happens to has done nothing wrong.
 */
describe('classifyCoverage', () => {
	it('places the Bergen concert outside, which is the whole reason this exists', () => {
		expect(classifyCoverage({ municipality: 'Bergen', venueName: 'Grieghallen' })).toEqual({
			state: 'outside',
			stated: 'Bergen'
		});
	});

	it('accepts each covered municipality by name', () => {
		for (const municipality of COVERED_MUNICIPALITIES) {
			const result = classifyCoverage({ municipality });
			expect(result).toMatchObject({ state: 'inside', municipality });
			// The word that decided it is reported, so the reasoning can name it.
			if (result.state === 'inside') expect(placeTokens(municipality)).toContain(result.matched);
		}
	});

	it('accepts a village or postal town, because that is what people write', () => {
		// Not a municipality since 1963, and still what the venue's own listing reports — see the
		// comment in importers/tec/src/ingest.ts.
		expect(classifyCoverage({ municipality: 'Bremnes' })).toMatchObject({
			state: 'inside',
			municipality: 'Bømlo'
		});
		expect(classifyCoverage({ municipality: 'Leirvik' })).toMatchObject({
			state: 'inside',
			municipality: 'Stord'
		});
	});

	it('reads a postnummer line, which is the shape our own importers see', () => {
		expect(classifyCoverage({ municipality: '5410 Sagvåg' })).toMatchObject({
			state: 'inside',
			municipality: 'Stord'
		});
	});

	it('matches a place typed without Norwegian letters', () => {
		expect(classifyCoverage({ municipality: 'Bomlo' })).toMatchObject({ state: 'inside' });
		expect(classifyCoverage({ municipality: 'sagvag' })).toMatchObject({ state: 'inside' });
	});

	it('accepts "Stord kommune" and does not read the word kommune as a place', () => {
		expect(classifyCoverage({ municipality: 'Stord kommune' })).toMatchObject({
			state: 'inside',
			municipality: 'Stord'
		});
	});

	it('does not mistake Stordal for Stord', () => {
		// 400km north, and `'stordal'.includes('stord')` is true. This is why matching is per token.
		expect(classifyCoverage({ municipality: 'Stordal' })).toEqual({
			state: 'outside',
			stated: 'Stordal'
		});
	});

	it('falls back to the venue name, because most senders skip the kommune box', () => {
		expect(classifyCoverage({ municipality: null, venueName: 'Stord kulturhus' })).toMatchObject({
			state: 'inside',
			municipality: 'Stord'
		});
		expect(classifyCoverage({ venueName: 'Moster Amfi' })).toMatchObject({
			state: 'inside',
			municipality: 'Bømlo'
		});
	});

	it('lets the venue name rescue an event whose kommune is a county', () => {
		expect(
			classifyCoverage({ municipality: 'Vestland', venueName: 'Bømlo kulturhus' })
		).toMatchObject({ state: 'inside', municipality: 'Bømlo' });
	});

	it('will not read "outside" off a venue name', () => {
		/*
		 * The asymmetry, stated as a test. A pub called "Bergen Bar" is in most towns in Norway,
		 * and a stated kommune of Stord is the fact here — the venue name is not allowed to
		 * outvote it, or this rule starts refusing local events for their signage.
		 */
		expect(classifyCoverage({ municipality: 'Stord', venueName: 'Bergen Bar' })).toMatchObject({
			state: 'inside',
			municipality: 'Stord'
		});
		// And with nothing stated it is a question, not a refusal.
		expect(classifyCoverage({ venueName: 'Bergen Bar' })).toEqual({
			state: 'unknown',
			reason: 'nothing-stated'
		});
	});

	it('asks rather than refuses when nothing places the event', () => {
		expect(classifyCoverage({})).toEqual({ state: 'unknown', reason: 'nothing-stated' });
		expect(classifyCoverage({ municipality: '   ' })).toEqual({
			state: 'unknown',
			reason: 'nothing-stated'
		});
	});

	it('asks rather than refuses when the answer is a county or a country', () => {
		// Stord is in Vestland, so "Vestland" is not evidence of anything but zoom level.
		for (const stated of ['Vestland', 'Hordaland', 'Sunnhordland', 'Noreg', 'Vestland fylke']) {
			expect(classifyCoverage({ municipality: stated })).toEqual({
				state: 'unknown',
				reason: 'too-broad'
			});
		}
	});
});

describe('the place lists themselves', () => {
	it('holds one word per entry, or the entry could never match', () => {
		// Matching is per token, so "Moster hamn" would be dead weight nobody would notice.
		for (const municipality of COVERED_MUNICIPALITIES) {
			for (const place of COVERED_PLACES[municipality]) {
				expect(placeTokens(place), `${municipality}: ${place}`).toHaveLength(1);
			}
		}
	});

	it('names no place in two municipalities at once', () => {
		const seen = new Map<string, string>();
		for (const municipality of COVERED_MUNICIPALITIES) {
			for (const place of COVERED_PLACES[municipality]) {
				// One token per entry is asserted above, so joining is the whole name.
				const token = placeTokens(place).join('');
				expect(seen.has(token), `${place} is claimed by ${seen.get(token)} too`).toBe(false);
				seen.set(token, municipality);
			}
		}
	});

	it('does not list a word that also means "we cannot tell"', () => {
		expect(classifyCoverage({ municipality: 'Sunnhordland' }).state).toBe('unknown');
	});
});

describe('coveredMunicipalitiesSentence', () => {
	it('writes the list out, so no copy has to retype it', () => {
		expect(coveredMunicipalitiesSentence()).toBe('Stord, Bømlo og Fitjar');
		expect(coveredMunicipalitiesSentence('eller')).toBe('Stord, Bømlo eller Fitjar');
	});
});
