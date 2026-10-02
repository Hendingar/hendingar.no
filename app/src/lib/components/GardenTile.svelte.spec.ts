import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import GardenTile from './GardenTile.svelte';
import '../styles/brand.css';

/**
 * The garden, in a real browser — the only place an SVG has a layout, and the only place the
 * animation has a computed style.
 */
describe('GardenTile', () => {
	it('plants a bed of flowers on their own white card', () => {
		const { container } = render(GardenTile, { id: 97 });
		expect(container.querySelectorAll('.garden__flower')).toHaveLength(5);
		// Their mark, as a file: one cached request rather than 24 KB of path data per card.
		expect(container.querySelector('image')?.getAttribute('href')).toBe('/hageselskapet.svg');
	});

	it('keeps every flower inside the card', () => {
		/*
		 * The stems are placed from the id, so a bad arithmetic change plants one off the edge —
		 * which looks like a cropped design rather than a bug until somebody measures it.
		 */
		const { container } = render(GardenTile, { id: 1234 });
		const svg = container.querySelector('svg') as SVGSVGElement;
		for (const flower of svg.querySelectorAll<SVGGElement>('.garden__flower')) {
			const box = flower.getBBox();
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(400);
			expect(box.y).toBeGreaterThanOrEqual(0);
			expect(box.y + box.height).toBeLessThanOrEqual(225);
		}
	});

	it('plants the same bed for the same event, every time', () => {
		// Deterministic like the generated tile it replaces: same server render, same client render,
		// and a screenshot test that does not flicker.
		const first = render(GardenTile, { id: 42 }).container.innerHTML;
		expect(render(GardenTile, { id: 42 }).container.innerHTML).toBe(first);
		expect(render(GardenTile, { id: 43 }).container.innerHTML).not.toBe(first);
	});

	it('sways, and each flower on its own clock', () => {
		const { container } = render(GardenTile, { id: 7 });
		const delays = [...container.querySelectorAll('.garden__flower')].map(
			(f) => getComputedStyle(f).animationDelay
		);
		expect(new Set(delays).size).toBeGreaterThan(1);
		// Svelte namespaces keyframes per component, so the name arrives as `svelte-<hash>-…`.
		expect(getComputedStyle(container.querySelector('.garden__flower')!).animationName).toMatch(
			/garden-sway$/
		);
	});
});
