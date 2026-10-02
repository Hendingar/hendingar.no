import { describe, expect, it } from 'vitest';
import { hasGardenSource, isGardenSource } from './garden-sources.ts';

describe('isGardenSource', () => {
	it('recognises a hagelag by the suffix the importer gives it', () => {
		// `bomlo-hagelag` today; `stord-hagelag` the day somebody adds it to instances.ts, with no
		// second place to remember.
		expect(isGardenSource('bomlo-hagelag')).toBe(true);
		expect(isGardenSource('stord-hagelag')).toBe(true);
	});

	it('does not sweep in a source that merely ends in those letters', () => {
		// The hyphen is the whole rule. A source called `hagelag` is not one of the local societies.
		expect(isGardenSource('hagelag')).toBe(false);
		expect(isGardenSource('bomlohagelag')).toBe(false);
		expect(isGardenSource('bomlo-aktivitetforalle')).toBe(false);
	});
});

describe('hasGardenSource', () => {
	it('is true when any reporting source is a hagelag', () => {
		// A consolidated event is reported by several calendars; one of them being the hagelag is
		// what makes this its event.
		expect(hasGardenSource(['stord-kulturhus', 'bomlo-hagelag'])).toBe(true);
	});

	it('is false for no sources at all, which is what a submission has', () => {
		expect(hasGardenSource([])).toBe(false);
		expect(hasGardenSource(undefined)).toBe(false);
	});
});
