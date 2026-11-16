import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_PAINTINGS, artworkFile, artworkFor } from './church-art.ts';

const STATIC = new URL('../../static/church-art/', import.meta.url);

/**
 * The table, and the rule that picks from it.
 *
 * Nothing here touches the network: the licence and the availability of every entry were
 * established once, when it was curated, and what a test can still protect is the shape — that no
 * entry is half-filled, and that the picker is the same on the server as in the browser.
 */
describe('the artwork table', () => {
	it('is big enough that a listing does not repeat itself', () => {
		expect(ALL_PAINTINGS.length).toBeGreaterThanOrEqual(30);
	});

	it('can name and credit every entry, because the caption has to', () => {
		for (const art of ALL_PAINTINGS) {
			expect(art.work.length, art.work).toBeGreaterThan(2);
			expect(art.artist.length, art.work).toBeGreaterThan(2);
			// A year is allowed to be missing — Commons does not state one for every work — but it
			// may never be an empty string, which would render as a stray comma.
			expect(art.year === null || art.year.length >= 4, art.work).toBe(true);
		}
	});

	it('links to the article, not to the file page', () => {
		// The point is reading about the painting. A Commons file page is a licence receipt.
		for (const art of ALL_PAINTINGS) {
			expect(art.articleUrl, art.work).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
		}
	});

	it('serves every image from our own origin, from a file that exists', () => {
		/*
		 * Hotlinked from Wikimedia, the paintings broke on phones: its media servers answer a burst
		 * from one address with 429, and a listing is a burst. A file missing from `static/` would
		 * break the same way, only for everyone.
		 */
		for (const art of ALL_PAINTINGS) {
			expect(art.widths.length, art.work).toBeGreaterThan(0);
			expect(
				[...art.widths].sort((x, y) => x - y),
				art.work
			).toEqual(art.widths);
			for (const width of art.widths) {
				const file = new URL(artworkFile(art, width).replace('/church-art/', ''), STATIC);
				expect(existsSync(file), file.pathname).toBe(true);
			}
			expect(art.sourceUrl, art.work).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
		}
	});

	it('holds no file the table does not name', () => {
		// The directory ships in every image of the site; an orphan is weight nobody sees.
		const named = new Set(
			ALL_PAINTINGS.flatMap((art) => art.widths.map((w) => `${art.file}-${w}.webp`))
		);
		for (const file of readdirSync(STATIC)) expect(named.has(file), file).toBe(true);
	});
});

describe('artworkFor', () => {
	it('gives a church event a painting', () => {
		expect(artworkFor(1185, 'kyrkjeliv')).not.toBeNull();
	});

	it('gives every other category nothing at all', () => {
		/*
		 * The whole feature is scoped by this line. A concert has its own poster and a match has
		 * its versus card; a painting on either would be an invention about somebody else's event.
		 */
		for (const category of ['musikk', 'sport', 'anna', 'teater', '']) {
			expect(artworkFor(1185, category), category).toBeNull();
		}
	});

	it('is the same painting for the same event, every time', () => {
		// Server and client render the same HTML, and a screenshot test stays stable. The id is the
		// only input; there is no clock and no randomness anywhere in the path.
		const first = artworkFor(742, 'kyrkjeliv');
		expect(artworkFor(742, 'kyrkjeliv')).toEqual(first);
		expect(artworkFor(743, 'kyrkjeliv')?.work).not.toBe(first?.work);
	});

	it('spreads consecutive ids across different paintings', () => {
		// Church events arrive from a parish calendar in one run, so their ids are consecutive and
		// they land next to each other in the listing. Neighbouring tiles must not match.
		const run = Array.from({ length: 12 }, (_, i) => artworkFor(900 + i, 'kyrkjeliv')?.work);
		expect(new Set(run).size).toBe(run.length);
	});

	it('resolves to our own files, with a descriptor per width', () => {
		const art = artworkFor(1185, 'kyrkjeliv');
		expect(art?.src).toMatch(/^\/church-art\/[a-z0-9-]+-\d+\.webp$/);
		for (const candidate of art?.srcset.split(', ') ?? []) {
			const [url, descriptor] = candidate.split(' ');
			expect(descriptor).toBe(`${/-(\d+)\.webp$/.exec(url ?? '')?.[1]}w`);
		}
	});

	it('is absolute when drawn on another origin', () => {
		// The MCP App view renders inside a chat client's frame, where `/church-art/…` resolves
		// against the client, not against us.
		const art = artworkFor(1185, 'kyrkjeliv', 'https://hendingar.no');
		expect(art?.src).toMatch(/^https:\/\/hendingar\.no\/church-art\//);
		expect(art?.srcset).not.toMatch(/(^|, )\//);
	});

	it('refuses an id that is not one', () => {
		for (const id of [-1, 1.5, Number.NaN]) {
			expect(artworkFor(id, 'kyrkjeliv'), String(id)).toBeNull();
		}
	});
});
