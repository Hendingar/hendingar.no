import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { parseFixture } from '@hendingar/core/fixture';
import VersusTile from './VersusTile.svelte';
import '../styles/brand.css';

/**
 * The tile in a real browser, which is the only place an SVG has a layout.
 *
 * `fixture-tile.spec.ts` proves the arithmetic under node. What it cannot prove is the thing that
 * actually goes wrong with drawn text: that the glyphs land inside the box. These assertions
 * measure the rendered ink, so a name that overflows fails here even if the estimate said it fit.
 */
const fixture = (title: string) => parseFixture(title)!;

/** The tile's own coordinate system, and the box every drawn thing has to stay inside. */
const VIEW = { width: 400, height: 225 };

function inkOf(svg: SVGSVGElement, node: SVGGraphicsElement) {
	const box = node.getBBox();
	const view = svg.getBoundingClientRect();
	const scale = view.width / VIEW.width;
	return { x: box.x * scale, width: box.width * scale, box };
}

describe('VersusTile', () => {
	it('keeps both club names inside the tile', async () => {
		render(VersusTile, {
			id: 1,
			fixture: fixture('Juristforeningen Studentidrettslag Menn senior A - Bremnes Menn Senior A')
		});
		const svg = document.querySelector('.vs svg') as SVGSVGElement;
		const names = [...svg.querySelectorAll<SVGTextElement>('.vs__name')];
		expect(names).toHaveLength(2);
		for (const name of names) {
			const { box } = inkOf(svg, name);
			expect(box.x, name.textContent ?? '').toBeGreaterThanOrEqual(0);
			expect(box.x + box.width, name.textContent ?? '').toBeLessThanOrEqual(VIEW.width);
			expect(box.y + box.height).toBeLessThanOrEqual(VIEW.height);
		}
	});

	it('draws the matchup and names it for a screen reader', async () => {
		render(VersusTile, {
			id: 2,
			fixture: fixture('Stord Fotball Menn Senior A - Vard Haugesund')
		});
		const tile = document.querySelector('.vs')!;
		expect(tile.getAttribute('aria-label')).toBe('Stord Fotball mot Vard Haugesund');
		// The SVG itself is hidden from the tree: every glyph in it is already in that label, and a
		// reader hearing "STORD FOTBALL VS VARD HAUGESUND" after it is hearing the tile twice.
		expect(tile.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
		expect([...tile.querySelectorAll('tspan')].map((t) => t.textContent)).toEqual([
			'STORD',
			'FOTBALL',
			'VARD',
			'HAUGESUND'
		]);
	});

	it('puts the crests beside the mark, clear of both names', () => {
		/*
		 * The one thing that can go wrong here and look like a design choice: a long club name
		 * running under its own crest. Measured rather than eyeballed, so a change to either the
		 * baselines or the chip geometry fails instead of shipping.
		 */
		render(VersusTile, {
			id: 5,
			fixture: fixture('Bremnes Menn Senior A - Juristforeningen Studentidrettslag Menn senior A'),
			feature: true
		});
		const svg = document.querySelector('.vs svg') as SVGSVGElement;
		const chips = [...svg.querySelectorAll<SVGImageElement>('image')];
		expect(chips).toHaveLength(2);
		for (const name of svg.querySelectorAll<SVGTextElement>('.vs__name')) {
			const text = name.getBBox();
			for (const chip of chips) {
				const crest = chip.getBBox();
				const overlaps =
					text.x < crest.x + crest.width &&
					crest.x < text.x + text.width &&
					text.y < crest.y + crest.height &&
					crest.y < text.y + text.height;
				expect(overlaps, `${name.textContent} over a crest`).toBe(false);
			}
		}
	});

	it('leaves the crests off a listing thumbnail', () => {
		/*
		 * Not a style rule, a weight one: NFF's crests average 33 KB and run to 82 KB, which is
		 * five to twenty times the rest of the card. A listing full of them would be the one part
		 * of this site that costs real bytes, and at 88px a crest is unreadable anyway.
		 */
		const { container } = render(VersusTile, {
			id: 6,
			fixture: fixture('Stord Fotball Menn Senior A - Vard Haugesund')
		});
		expect(container.querySelectorAll('image')).toHaveLength(0);
	});

	it('draws the wordmark alone for a club we have no crest for', () => {
		const { container } = render(VersusTile, {
			id: 7,
			fixture: fixture('Stord Fotball Menn Senior A - Ukjend Ballklubb Menn Senior A'),
			feature: true
		});
		// One crest, not none and not a placeholder: the half we know is still worth drawing.
		expect(container.querySelectorAll('image')).toHaveLength(1);
	});

	it('only moves when it is the card on an event page', async () => {
		const still = render(VersusTile, {
			id: 3,
			fixture: fixture('Os Menn Senior A - Bremnes Menn Senior A')
		});
		const mark = still.container.querySelector('.vs__mark')!;
		expect(getComputedStyle(mark).animationName).toBe('none');
		still.unmount();

		const moving = render(VersusTile, {
			id: 4,
			fixture: fixture('Os Menn Senior A - Bremnes Menn Senior A'),
			feature: true
		});
		const featured = moving.container.querySelector('.vs__mark')!;
		expect(getComputedStyle(featured).animationName).not.toBe('none');
	});
});
