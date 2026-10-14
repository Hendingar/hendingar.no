import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { handballTitle, parseHandballMatch } from '@hendingar/core/handball';
import HandballTile from './HandballTile.svelte';
import '../styles/brand.css';

/**
 * The card in a real browser, which is the only place an SVG has a layout.
 *
 * `handball-tile.spec.ts` proves the arithmetic under node; these measure the rendered ink, so a
 * name that runs into the goal or off the card fails here even if the estimate said it fit.
 */
const match = (away: string, team: 'menn' | 'kvinner' = 'menn') =>
	parseHandballMatch(handballTitle('Stord', away, team))!;

const VIEW = { width: 400, height: 225 };
/** Where the left post of the goal begins. A name must stop short of it. */
const GOAL_X = 252;

describe('HandballTile', () => {
	it('keeps both names in the left column, clear of the goal', () => {
		render(HandballTile, { id: 1, match: match('Bergensdalen Idrettslag') });
		const names = [...document.querySelectorAll<SVGTextElement>('.hb__name')];
		expect(names).toHaveLength(2);
		for (const name of names) {
			const box = name.getBBox();
			expect(box.x, name.textContent ?? '').toBeGreaterThanOrEqual(0);
			expect(box.x + box.width, name.textContent ?? '').toBeLessThanOrEqual(GOAL_X);
			expect(box.y + box.height, name.textContent ?? '').toBeLessThanOrEqual(VIEW.height);
		}
	});

	it('names the match for a screen reader, and hides the drawing', () => {
		render(HandballTile, { id: 2, match: match('Ros') });
		const tile = document.querySelector('.hb')!;
		expect(tile.getAttribute('aria-label')).toBe('Handballkamp: Stord mot Ros, menn');
		expect(tile.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
		expect([...tile.querySelectorAll('tspan')].map((t) => t.textContent)).toEqual(['STORD', 'ROS']);
	});

	it('wears the home club’s kit', () => {
		const { container } = render(HandballTile, { id: 3, match: match('Bønes', 'kvinner') });
		expect(container.querySelector('.hb')!.classList.contains('kit--stord')).toBe(true);
	});

	it('sends the finished card, and throws only once it is on screen', async () => {
		const below = document.createElement('div');
		below.style.marginBlockStart = '400vh';
		below.style.inlineSize = '400px';
		document.body.append(below);
		const still = render(HandballTile, { target: below, props: { id: 4, match: match('Ros') } });
		const parked = still.container.querySelector('.hb')!;
		expect(parked.classList.contains('hb--live')).toBe(false);
		expect(getComputedStyle(parked.querySelector('.hb__ball')!).animationName).toBe('none');
		still.unmount();
		below.remove();

		const host = document.createElement('div');
		host.style.inlineSize = '400px';
		document.body.prepend(host);
		const { container } = render(HandballTile, {
			target: host,
			props: { id: 5, match: match('Ros') }
		});
		const tile = container.querySelector('.hb')!;
		await expect.poll(() => tile.classList.contains('hb--live')).toBe(true);
		expect(getComputedStyle(tile.querySelector('.hb__ball')!).animationName).toMatch(/hb-shot$/);
		expect(getComputedStyle(tile.querySelector('.hb__hand')!).animationName).toMatch(/hb-throw$/);
		host.remove();
	});
});
