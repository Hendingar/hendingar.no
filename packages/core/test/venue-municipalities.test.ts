import { describe, expect, it } from 'vitest';
import { VENUE_ALIASES } from '../src/venue-aliases.ts';
import { VENUE_MUNICIPALITIES, knownVenueMunicipality } from '../src/venue-municipalities.ts';
import { normaliseTitle } from '../src/similarity.ts';

describe('knownVenueMunicipality', () => {
	it('places the rooms the Stord programmes name', () => {
		expect(knownVenueMunicipality('stord-kulturhus', 'Osvald Pub')).toBe('Stord');
		expect(knownVenueMunicipality('stord-aktivitetforalle', 'Osvald Pub')).toBe('Stord');
		expect(knownVenueMunicipality('stord-kino', 'Småsalen')).toBe('Stord');
		expect(knownVenueMunicipality('stord-kulturhus', 'SMÅSALEN')).toBe('Stord');
	});

	it('leaves a room name shared with Bømlo unplaced', () => {
		/*
		 * `storsalen` and `biblioteket` are each one venue row holding events from both culture
		 * houses. Placing the row in Stord would drop Bømlo's films and concerts out of the Bømlo
		 * filter, so neither name may be listed for any source until the rows are split.
		 */
		for (const source of ['stord-kulturhus', 'stord-kino', 'stord-aktivitetforalle']) {
			expect(knownVenueMunicipality(source, 'Storsalen'), source).toBeNull();
			expect(knownVenueMunicipality(source, 'Biblioteket'), source).toBeNull();
		}
	});

	it('never lists a name that a source in another municipality also writes', () => {
		// The alias list knows which sources write which room names. A listed name that an alias
		// places in a Bømlo building is the shared-row trap above, arriving by a new entry.
		const bomloNames = new Set(
			VENUE_ALIASES.filter((a) => /bømlo/i.test(a.place)).map((a) => normaliseTitle(a.name))
		);
		for (const entry of VENUE_MUNICIPALITIES) {
			if (entry.municipality === 'Bømlo') continue;
			expect(bomloNames.has(normaliseTitle(entry.name)), entry.name).toBe(false);
		}
	});

	it('places nothing for a source that did not write the name, or for a submission', () => {
		expect(knownVenueMunicipality('bomlo-kulturhus', 'Osvald Pub')).toBeNull();
		expect(knownVenueMunicipality(null, 'Osvald Pub')).toBeNull();
		expect(knownVenueMunicipality('stord-kulturhus', null)).toBeNull();
	});

	it('gives every entry a reason', () => {
		for (const entry of VENUE_MUNICIPALITIES) {
			expect(entry.evidence.length, entry.name).toBeGreaterThan(10);
			expect(entry.sources.length, entry.name).toBeGreaterThan(0);
		}
	});
});
