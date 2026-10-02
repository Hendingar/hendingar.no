import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFixture } from '../src/fixture.ts';

/**
 * Against the committed NFF feeds, which is the only honest corpus for this: the rule exists to
 * read titles NFF writes, and NFF writes them in four spellings that no invented example contains.
 */
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

const titles = [
	...new Set(
		readdirSync(FEEDS)
			.filter((f) => f.endsWith('.ics'))
			.flatMap(summaries)
	)
].sort();

describe('parseFixture', () => {
	it('reads every fixture in the committed feeds', () => {
		expect(titles.length).toBeGreaterThan(50);
		for (const title of titles) {
			const fixture = parseFixture(title);
			expect(fixture, title).not.toBeNull();
			// Never an empty side: the tile draws these, and an empty string draws as nothing at all
			// with no error anywhere.
			expect(fixture!.home.club.length, title).toBeGreaterThan(0);
			expect(fixture!.away.club.length, title).toBeGreaterThan(0);
			expect(fixture!.home.club, title).not.toMatch(/\b(Menn|Kvinner)\b/);
		}
	});

	it('takes the grade off the club and keeps it', () => {
		expect(parseFixture('Stord Fotball Menn Senior A - Vard Haugesund')).toEqual({
			home: { club: 'Stord Fotball', grade: 'Menn Senior A' },
			away: { club: 'Vard Haugesund', grade: null },
			grade: null
		});
	});

	it('reports one grade when both sides agree, whatever the case', () => {
		// Two rows apart in the same feed: "Fitjar Menn senior A" and "Smørås Menn Senior A". A
		// capital letter is not a different grade, and printing both would say so.
		const fixture = parseFixture('Fitjar Menn senior A - Smørås Menn Senior A');
		expect(fixture?.grade).toBe('Menn senior A');
	});

	it('reports no grade when the sides are in different ones', () => {
		expect(parseFixture('Stord Fotball Menn Senior A - Sogndal Menn 2')?.grade).toBeNull();
	});

	it('splits on the separator, never on a hyphen inside a club', () => {
		// Fløy-Flekkerøy is one club. The importer refuses to decide the home side from this dash
		// for the same reason.
		const fixture = parseFixture('Fløy-Flekkerøy Menn Senior A - Stord Fotball Menn Senior A');
		expect(fixture?.home.club).toBe('Fløy-Flekkerøy');
	});

	it('keeps a club whose name ends in digits', () => {
		// "Djerv 1919" has no grade at all, and 1919 is the club's year, not its team number.
		expect(parseFixture('Stord Fotball Menn Senior A - Djerv 1919')?.away).toEqual({
			club: 'Djerv 1919',
			grade: null
		});
	});

	it('refuses a title that is merely punctuated like a fixture', () => {
		/*
		 * The reason a grade is required. These are real listing titles, and a versus card between
		 * Konsert and Koret Lyren would be worse than no card at all.
		 */
		expect(parseFixture('Konsert - Koret Lyren')).toBeNull();
		expect(parseFixture('Bygdekino: Kunsten å vere lykkeleg')).toBeNull();
		expect(parseFixture('Bård Tufte Johansen — Prøver å være positiv')).toBeNull();
		expect(parseFixture('Quiz på Kaikanten')).toBeNull();
		expect(parseFixture(null)).toBeNull();
		expect(parseFixture('')).toBeNull();
	});

	it('refuses a title with two separators rather than guessing which divides the sides', () => {
		expect(parseFixture('Stord Menn Senior A - Noko - Anna')).toBeNull();
	});
});
