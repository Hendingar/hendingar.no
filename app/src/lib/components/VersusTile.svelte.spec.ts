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
