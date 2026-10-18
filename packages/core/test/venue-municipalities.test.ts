import { describe, expect, it } from 'vitest';
import { venueSlugFor } from '../src/venue-aliases.ts';
import { slugifyVenue } from '../src/slug.ts';
import { VENUE_MUNICIPALITIES, knownVenueMunicipality } from '../src/venue-municipalities.ts';
import { normaliseTitle } from '../src/similarity.ts';

describe('knownVenueMunicipality', () => {
	it('places the rooms the Stord programmes name', () => {
		expect(knownVenueMunicipality('stord-kulturhus', 'Osvald Pub')).toBe('Stord');
		expect(knownVenueMunicipality('stord-aktivitetforalle', 'Osvald Pub')).toBe('Stord');
		expect(knownVenueMunicipality('stord-kino', 'Småsalen')).toBe('Stord');
		expect(knownVenueMunicipality('stord-kulturhus', 'SMÅSALEN')).toBe('Stord');
	});

	it("places each building's Storsalen and Biblioteket in its own municipality", () => {
		expect(knownVenueMunicipality('stord-kulturhus', 'Storsalen')).toBe('Stord');
		expect(knownVenueMunicipality('bomlo-kino', 'Storsalen')).toBe('Bømlo');
		expect(knownVenueMunicipality('stord-aktivitetforalle', 'Biblioteket')).toBe('Stord');
		expect(knownVenueMunicipality('bomlo-aktivitetforalle', 'Biblioteket')).toBe('Bømlo');
	});

	it('places a shared room name only where its source writes a row of its own', () => {
		/*
		 * The trap the split exists to remove. A source with no alias for "Storsalen" writes the
		 * plain `storsalen` row, which both towns' unresolved events can land on. Placing it from
		 * here would put half of them in the wrong municipality.
		 */
		for (const entry of VENUE_MUNICIPALITIES) {
			const others = VENUE_MUNICIPALITIES.filter(
				(other) =>
					normaliseTitle(other.name) === normaliseTitle(entry.name) &&
					other.municipality !== entry.municipality
			);
			if (others.length === 0) continue;
			for (const source of entry.sources) {
				expect(venueSlugFor(source, entry.name), `${source} ${entry.name}`).not.toBe(
					slugifyVenue(entry.name)
				);
			}
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
