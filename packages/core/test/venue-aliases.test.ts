import { describe, expect, it } from 'vitest';
import { VENUE_ALIASES, resolveVenueName } from '../src/venue-aliases.ts';
import { normaliseTitle } from '../src/similarity.ts';

describe('resolveVenueName', () => {
	it('turns a room into the building the other sources name', () => {
		expect(resolveVenueName('stord-kulturhus', 'Storsalen')).toBe('Stord kulturhus');
	});

	it('reads the same room name as a different building for a different source', () => {
		/*
		 * The reason every entry is scoped to a source, and not a nicety. `Storsalen` is one
		 * `venues` row in the live database carrying events from both calendars: in one it is the
		 * main hall of Stord kulturhus, in the other the main hall of Bømlo Kulturhus, a different
		 * building in a different municipality. A list keyed on the name alone would put Bømlo's
		 * hall in Stord.
		 */
		expect(resolveVenueName('bomlo-aktivitetforalle', 'Storsalen')).toBe('Bømlo Kulturhus');
		expect(resolveVenueName('stord-kulturhus', 'Storsalen')).not.toBe(
			resolveVenueName('bomlo-aktivitetforalle', 'Storsalen')
		);
	});

	it('resolves both sources that name the same room the same way', () => {
		/*
		 * The asymmetry trap, and the reason this is a test and not just a list.
		 *
		 * `bomlo-kulturhus` and `bomlo-aktivitetforalle` both carry the culture house's programme
		 * and both write the room, so they agreed before either was listed here. Listing only one
		 * of them broke that: one side resolved to the building, the other stayed `Storsalen`, and
		 * `venueSimilarity` between those is 0 — so a title the pair had already matched on was
		 * refused on venue. Thirteen of this venue's 28 events were about to publish twice.
		 */
		for (const room of ['Storsalen', 'Litlesalen', 'Kulturhuskafeen', 'Foajéen']) {
			expect(resolveVenueName('bomlo-kulturhus', room), room).toBe('Bømlo Kulturhus');
			expect(resolveVenueName('bomlo-aktivitetforalle', room), room).toBe(
				resolveVenueName('bomlo-kulturhus', room)
			);
		}
	});

	it('leaves a hall in another building where it is', () => {
		// The house programmes a concert in Bremnes church and writes the church's name. Folding
		// that onto the culture house would put the event in a building it is not in — the mirror
		// of the mistake this file exists to prevent.
		expect(resolveVenueName('bomlo-kulturhus', 'Bremnes kyrkje')).toBe('Bremnes kyrkje');
	});

	it('leaves an unlisted name exactly as it found it', () => {
		expect(resolveVenueName('stord-kulturhus', 'Osvald Pub')).toBe('Osvald Pub');
		expect(resolveVenueName('bomlo-kyrkja', 'Moster kyrkje')).toBe('Moster kyrkje');
	});

	it('resolves nothing for a submission, which has no source', () => {
		// A person typing "Storsalen" has not said which town they mean. Guessing on their behalf
		// is exactly the merge that would hide somebody's event.
		expect(resolveVenueName(null, 'Storsalen')).toBe('Storsalen');
	});

	it('resolves nothing for a source that has no entries', () => {
		expect(resolveVenueName('dnt-bomlo', 'Storsalen')).toBe('Storsalen');
	});

	it('matches normalised, so case and punctuation may drift upstream', () => {
		expect(resolveVenueName('stord-kulturhus', 'STORSALEN')).toBe('Stord kulturhus');
		expect(resolveVenueName('stord-kulturhus', 'Scene,  Storsal')).toBe('Stord kulturhus');
	});
});

describe('VENUE_ALIASES', () => {
	it('lists each (source, name) once, so resolution cannot depend on order', () => {
		const keys = VENUE_ALIASES.map((a) => `${a.source} ${normaliseTitle(a.name)}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('never resolves to a name that is itself an alias for that source', () => {
		// Resolution runs once, not to a fixed point. A chain would silently resolve halfway.
		const keys = new Set(VENUE_ALIASES.map((a) => `${a.source} ${normaliseTitle(a.name)}`));
		for (const alias of VENUE_ALIASES) {
			expect(keys.has(`${alias.source} ${normaliseTitle(alias.place)}`)).toBe(false);
		}
	});

	it('says how each entry is known, because every one is a claim about a real place', () => {
		for (const alias of VENUE_ALIASES) {
			expect(alias.evidence.length).toBeGreaterThan(20);
			expect(normaliseTitle(alias.name)).not.toBe('');
			expect(normaliseTitle(alias.place)).not.toBe('');
		}
	});
});
