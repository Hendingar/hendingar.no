import { describe, expect, it } from 'vitest';
import { LINKED_SOURCES, SOURCE_PLATFORMS, platformOf } from '../src/directory.ts';

describe('platformOf', () => {
	it('groups a platform organiser under its platform', () => {
		expect(platformOf('allevents-stord-jazzklubb')?.slug).toBe('allevents');
		expect(platformOf('billetto-bremnes-idrettslag')?.slug).toBe('billetto');
		expect(platformOf('dnt-stord-fitjar')?.slug).toBe('dnt');
		expect(platformOf('luma-tcw')?.slug).toBe('luma');
		expect(platformOf('dnt-bomlo')?.slug).toBe('dnt');
	});

	it('leaves a source that stands on its own alone', () => {
		/*
		 * `bomlo-kulturhus` is the near-miss worth naming: `bomlo-teater` *is* a platform, so the
		 * two share the letters `bomlo-` and only the requirement that the whole prefix be
		 * followed by a hyphen keeps the culture house out of the theatre's group. The test below
		 * states that rule; this one is the live slug it protects.
		 */
		for (const slug of [
			'stord-kulturhus',
			'bomlo-kulturhus',
			'bomlobibliotek',
			'sunnhordland-museum',
			'innsendt'
		]) {
			expect(platformOf(slug), slug).toBeNull();
		}
	});

	/**
	 * The prefix has to be followed by a hyphen.
	 *
	 * Without it any slug merely *starting* with the letters of a platform is swallowed — and the
	 * failure would be silent and wrong in the worst direction, filing somebody else's calendar
	 * under a platform they have nothing to do with.
	 */
	it('matches on the whole prefix, not on the letters', () => {
		expect(platformOf('dntx-noko')).toBeNull();
		expect(platformOf('alleventsish-hei')).toBeNull();
		expect(platformOf('billettoteket')).toBeNull();
	});

	it('never treats a bare platform name as one of its own organisers', () => {
		// A platform is a grouping. If a row is ever called just `allevents`, it is a source in its
		// own right and grouping it under itself would render an empty group containing nothing.
		for (const platform of SOURCE_PLATFORMS) {
			expect(platformOf(platform.slug), platform.slug).toBeNull();
		}
	});

	it('no linked source is accidentally captured by a platform prefix', () => {
		// These are hand-written slugs; a collision would move a source into a group silently.
		for (const source of LINKED_SOURCES) {
			const platform = platformOf(source.slug);
			if (platform) {
				expect(source.slug.startsWith(`${platform.slug}-`), source.slug).toBe(true);
			}
		}
	});

	it('every platform is described for a reader, not just named', () => {
		// /kjelder renders the note verbatim; an empty one leaves a heading with no explanation of
		// what the grouping means.
		for (const platform of SOURCE_PLATFORMS) {
			expect(platform.note.length, platform.slug).toBeGreaterThan(30);
			expect(platform.url, platform.slug).toMatch(/^https:\/\//);
		}
	});
});
