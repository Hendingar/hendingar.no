import { describe, expect, it } from 'vitest';
import { ALL_ARTWORKS, artworkFor } from './church-art.ts';

/**
 * The table, and the rule that picks from it.
 *
 * Nothing here touches the network: the licence and the availability of every entry were
 * established once, when it was curated, and what a test can still protect is the shape — that no
 * entry is half-filled, and that the picker is the same on the server as in the browser.
 */
describe('the artwork table', () => {
	it('is big enough that a listing does not repeat itself', () => {
		expect(ALL_ARTWORKS.length).toBeGreaterThanOrEqual(30);
	});

	it('can name and credit every entry, because the caption has to', () => {
		for (const art of ALL_ARTWORKS) {
			expect(art.work.length, art.work).toBeGreaterThan(2);
			expect(art.artist.length, art.work).toBeGreaterThan(2);
			// A year is allowed to be missing — Commons does not state one for every work — but it
			// may never be an empty string, which would render as a stray comma.
			expect(art.year === null || art.year.length >= 4, art.work).toBe(true);
		}
	});

	it('links to the article, not to the file page', () => {
		// The point is reading about the painting. A Commons file page is a licence receipt.
		for (const art of ALL_ARTWORKS) {
			expect(art.articleUrl, art.work).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
		}
	});

	it('serves the images from Wikimedia, at a rendition that exists', () => {
		for (const art of ALL_ARTWORKS) {
			expect(art.src, art.work).toMatch(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//);
			if (art.srcset === null) continue;
			/*
			 * Every descriptor matches the width in its own URL.
			 *
			 * Not a formality: the Commons thumbnailer snaps a request to a size it already holds,
			 * so asking for 640 answers with 960. A srcset that repeated the width we asked for
			 * would tell the browser the file is smaller than it is, and it would pick the wrong
			 * one at every breakpoint.
			 */
			for (const candidate of art.srcset.split(', ')) {
				const [url, descriptor] = candidate.split(' ');
				expect(url, art.work).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
				const inUrl = /\/(\d+)px-/.exec(url!)?.[1];
				if (inUrl) {
					expect(descriptor, `${art.work}: ${url}`).toBe(`${inUrl}w`);
				} else {
					// No `NNNpx-` means Commons served the original, because the file is smaller
					// than the rendition we asked for. The descriptor is then the file's own width.
					expect(descriptor, `${art.work}: ${url}`).toMatch(/^[1-9]\d{2,4}w$/);
				}
			}
		}
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
		expect(artworkFor(742, 'kyrkjeliv')).toBe(first);
		expect(artworkFor(743, 'kyrkjeliv')).not.toBe(first);
	});

	it('spreads consecutive ids across different paintings', () => {
		// Church events arrive from a parish calendar in one run, so their ids are consecutive and
		// they land next to each other in the listing. Neighbouring tiles must not match.
		const run = Array.from({ length: 12 }, (_, i) => artworkFor(900 + i, 'kyrkjeliv')?.work);
		expect(new Set(run).size).toBe(run.length);
	});

	it('refuses an id that is not one', () => {
		for (const id of [-1, 1.5, Number.NaN]) {
			expect(artworkFor(id, 'kyrkjeliv'), String(id)).toBeNull();
		}
	});
});
