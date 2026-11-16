import { describe, expect, it } from 'vitest';
import {
	ALL_PAINTINGS,
	artworkForFileName,
	artworkFor,
	artworkPath,
	artworkWidths
} from './church-art.ts';

/**
 * The table, and the rule that picks from it.
 *
 * Nothing here touches the network: the licence and the availability of every entry were
 * established once, when it was curated, and what a test can still protect is the shape — that no
 * entry is half-filled, and that the picker is the same on the server as in the browser.
 */
describe('the artwork table', () => {
	it('is big enough that a listing does not repeat itself', () => {
		expect(ALL_PAINTINGS.length).toBeGreaterThanOrEqual(90);
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

	it('names every painting by a file stem that is unique and safe in a path', () => {
		const stems = ALL_PAINTINGS.map((art) => art.file);
		expect(new Set(stems).size).toBe(stems.length);
		for (const stem of stems) expect(stem).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
	});

	it('knows where on Commons each one came from, and how big that file is', () => {
		for (const art of ALL_PAINTINGS) {
			expect(art.sourceUrl, art.work).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
			expect(art.width, art.work).toBeGreaterThanOrEqual(320);
			expect(art.height, art.work).toBeGreaterThanOrEqual(200);
		}
	});
});

describe('artworkWidths', () => {
	it('gives the two tile sizes and one large one bounded by 1280×1600', () => {
		expect(artworkWidths({ width: 1280, height: 853 })).toEqual([320, 640, 1280]);
		// A tall portrait: 1600 high is the limit, so 1280×2581 becomes 793 wide, not 1280.
		expect(artworkWidths({ width: 1280, height: 2581 })).toEqual([320, 640, 793]);
	});

	it('never enlarges, and drops a large size that would barely differ from 640', () => {
		expect(artworkWidths({ width: 900, height: 1200 })).toEqual([320, 640, 900]);
		expect(artworkWidths({ width: 680, height: 900 })).toEqual([320, 640]);
		expect(artworkWidths({ width: 500, height: 400 })).toEqual([320, 500]);
	});
});

describe('artworkForFileName', () => {
	const [first] = ALL_PAINTINGS;

	it('reads back exactly the names artworkFor hands out', () => {
		for (const art of ALL_PAINTINGS) {
			for (const width of artworkWidths(art)) {
				const name = artworkPath(art, width).split('/').at(-1) ?? '';
				expect(artworkForFileName(name), name).toEqual({ painting: art, width });
			}
		}
	});

	it('refuses anything else, so a crafted path cannot make the server fetch or encode', () => {
		for (const name of [
			`${first?.file}-641`,
			`${first?.file}-640.webp`,
			'not-a-painting-320',
			'../../etc/passwd-320',
			''
		]) {
			expect(artworkForFileName(name), name).toBeNull();
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
		expect(art?.src).toMatch(/^\/church-art\/v1\/[a-z0-9-]+-\d+$/);
		for (const candidate of art?.srcset.split(', ') ?? []) {
			const [url, descriptor] = candidate.split(' ');
			expect(descriptor).toBe(`${/-(\d+)$/.exec(url ?? '')?.[1]}w`);
		}
	});

	it('is absolute when drawn on another origin', () => {
		// The MCP App view renders inside a chat client's frame, where `/church-art/…` resolves
		// against the client, not against us.
		const art = artworkFor(1185, 'kyrkjeliv', 'https://hendingar.no');
		expect(art?.src).toMatch(/^https:\/\/hendingar\.no\/church-art\/v1\//);
		expect(art?.srcset).not.toMatch(/(^|, )\//);
	});

	it('refuses an id that is not one', () => {
		for (const id of [-1, 1.5, Number.NaN]) {
			expect(artworkFor(id, 'kyrkjeliv'), String(id)).toBeNull();
		}
	});
});
