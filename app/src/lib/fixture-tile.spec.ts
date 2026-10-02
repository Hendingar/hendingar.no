import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFixture } from '@hendingar/core/fixture';
import { fixtureTile, layoutClubName } from './fixture-tile.ts';

/**
 * The arithmetic behind the versus tile.
 *
 * SVG text neither wraps nor shrinks, so a name that does not fit simply leaves the tile — no
 * error, no clipping warning, just glyphs over the edge. Every assertion here is that bound.
 */

/** The widest a capital can advance, from brand.css. The same number `fixture-tile.ts` sizes by. */
const ADVANCE = 0.92;
const BAND = 230;

const FEEDS = fileURLToPath(new URL('../../../importers/fotball/test/fixtures/', import.meta.url));
/**
 * The SUMMARY lines out of a committed feed.
 *
 * Unfolded by hand rather than with the importer's iCal parser: that lives in
 * `importers/fotball`, which is not a dependency of this package and should not become one for a
 * test. A continuation line in iCalendar begins with a space — that is the whole format here.
 */
function summaries(file: string): string[] {
	const unfolded = readFileSync(FEEDS + file, 'utf8').replace(/\r?\n[ \t]/g, '');
	return [...unfolded.matchAll(/^SUMMARY:(.+)$/gm)].map((m) => m[1]!.replace(/\\,/g, ',').trim());
}

const clubs = [
	...new Set(
		readdirSync(FEEDS)
			.filter((f) => f.endsWith('.ics'))
			.flatMap(summaries)
			.map((title) => parseFixture(title))
			.flatMap((fixture) => (fixture ? [fixture.home.club, fixture.away.club] : []))
	)
].sort();

describe('layoutClubName', () => {
	it('fits every club in the committed feeds inside the band', () => {
		expect(clubs.length).toBeGreaterThan(20);
		for (const club of clubs) {
			const { lines, fontSize } = layoutClubName(club);
			const widest = Math.max(...lines.map((line) => line.length)) * ADVANCE * fontSize;
			expect(widest, `${club} at ${fontSize}`).toBeLessThanOrEqual(BAND);
			expect(lines.length).toBeLessThanOrEqual(2);
			expect(lines.join(' ')).toBe(club.toUpperCase());
		}
	});

	it('stacks a two-word club rather than stringing it out', () => {
		/*
		 * The whole reason the names are set on two lines: "STORD FOTBALL" on one line has to be
		 * 19 units to fit, and stacked it fits at 34. On a 310px card that is a wordmark instead of
		 * a smudge.
		 */
		expect(layoutClubName('Stord Fotball')).toEqual({ lines: ['STORD', 'FOTBALL'], fontSize: 34 });
	});

	it('breaks where the two halves are most even', () => {
		// Not at the first space: "JURISTFORENINGEN" is longer than "STUDENTIDRETTSLAG" is on its
		// own, and the longer half is what sets the size.
		expect(layoutClubName('Juristforeningen Studentidrettslag').lines).toEqual([
			'JURISTFORENINGEN',
			'STUDENTIDRETTSLAG'
		]);
	});

	it('leaves a one-word club on one line', () => {
		expect(layoutClubName('Bremnes').lines).toEqual(['BREMNES']);
	});

	it('never goes below the floor, however long the name', () => {
		const { fontSize } = layoutClubName('Sunnhordlandsmeisterskapen');
		expect(fontSize).toBeGreaterThanOrEqual(13);
	});
});

describe('fixtureTile', () => {
	it('says the matchup out loud for a screen reader', () => {
		// Every glyph in the tile is drawn, so the label is the only thing that is readable.
		const tile = fixtureTile(parseFixture('Stord Fotball Menn Senior A - Vard Haugesund')!);
		expect(tile.label).toBe('Stord Fotball mot Vard Haugesund');
		expect(tile.grade).toBeNull();
	});
});
