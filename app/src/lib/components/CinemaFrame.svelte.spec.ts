import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import CinemaFrame from './CinemaFrame.svelte';
import '../styles/brand.css';

const poster = createRawSnippet(() => ({ render: () => '<div class="thumb">poster</div>' }));

describe('CinemaFrame', () => {
	it('chalks the screening time on the slate, and hides the frame from a screen reader', () => {
		const { container } = render(CinemaFrame, { slate: '19:30', children: poster });
		expect(container.querySelector('.cine__slate')!.textContent).toBe('19:30');
		for (const part of container.querySelectorAll('.cine__bar, .cine__clapper')) {
			expect(part.getAttribute('aria-hidden')).toBe('true');
		}
		// The poster itself is still there, and still the thumbnail.
		expect(container.querySelector('.cine__picture > .thumb')!.textContent).toBe('poster');
	});

	it('lets go of its entrance once it has played, so hovering can open the bars', async () => {
		/*
		 * The bug this guards: a finished animation filling `both` keeps holding the bars'
		 * transform, and an animation outranks the hover transition — the bars never opened.
		 */
		const { container } = render(CinemaFrame, { slate: '19:30', children: poster });
		const frame = container.querySelector('.cine')!;
		await expect.poll(() => frame.classList.contains('cine--live')).toBe(true);
		for (const a of frame.getAnimations({ subtree: true })) a.finish();
		await expect.poll(() => frame.classList.contains('cine--live')).toBe(false);
		expect(getComputedStyle(frame.querySelector('.cine__bar--top')!).animationName).toBe('none');
	});
});
