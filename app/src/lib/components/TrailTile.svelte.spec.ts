import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TrailTile from './TrailTile.svelte';
import '../styles/brand.css';

/** In a real browser, where the chips have a layout and the reveal has a viewport. */
describe('TrailTile', () => {
	it('says what it draws, once, to a screen reader', () => {
		const { container } = render(TrailTile, {
			id: 1,
			trail: { grade: 'middels', audiences: ['vaksne', 'seniorar'] }
		});
		const tile = container.querySelector('.tt')!;
		expect(tile.getAttribute('aria-label')).toBe('Tur, middels, for vaksne og seniorar');
		expect(tile.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
	});

	it('wears the grade’s own trail-sign colour, and a figure per audience', () => {
		const { container } = render(TrailTile, {
			id: 2,
			trail: { grade: 'krevende', audiences: ['barn', 'tilrettelagt'] }
		});
		const tile = container.querySelector<HTMLElement>('.tt')!;
		expect(getComputedStyle(tile).getPropertyValue('--grade').trim()).toBe(
			getComputedStyle(document.documentElement).getPropertyValue('--trail-krevende').trim()
		);
		expect(tile.querySelector('.tt__grade')!.textContent).toBe('KREVJANDE');
		expect(tile.querySelectorAll('.tt__figure')).toHaveLength(2);
	});

	it('keeps its chips inside the card', () => {
		const { container } = render(TrailTile, {
			id: 3,
			trail: { grade: 'krevende', audiences: ['barn', 'ungdom', 'vaksne', 'seniorar'] }
		});
		const svg = container.querySelector('svg')!;
		const box = container.querySelector<SVGGElement>('.tt__chips')!.getBBox();
		expect(box.x).toBeGreaterThanOrEqual(87.5);
		expect(box.x + box.width).toBeLessThanOrEqual(312.5);
		expect(box.y + box.height).toBeLessThanOrEqual(225);
		expect(svg).toBeTruthy();
	});

	it('is the finished card far below the fold, and climbs once on screen', async () => {
		const below = document.createElement('div');
		below.style.marginBlockStart = '400vh';
		document.body.append(below);
		const far = render(TrailTile, {
			target: below,
			props: { id: 4, trail: { grade: 'enkel', audiences: [] } }
		});
		expect(far.container.querySelector('.tt')!.classList.contains('tt--live')).toBe(false);
		below.remove();

		const near = render(TrailTile, { id: 5, trail: { grade: 'enkel', audiences: [] } });
		const tile = near.container.querySelector('.tt')!;
		await expect.poll(() => tile.classList.contains('tt--live')).toBe(true);
		expect(getComputedStyle(tile.querySelector('.tt__walk')!).animationName).toMatch(/tt-walk$/);
	});
});
