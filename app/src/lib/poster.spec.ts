import { describe, expect, it } from 'vitest';
import { THUMB_ASPECT, fitToAspect, usableCrop } from './poster.ts';

/*
 * A square source, so a fraction-aspect and a pixel-aspect are the same number and these cases stay
 * readable. The non-square case — where they are emphatically not the same — is covered in
 * poster.svelte.spec.ts, which decodes the JPEG the canvas actually produced.
 */
const SQUARE = 1;

describe('usableCrop', () => {
	it('accepts a sane box', () => {
		expect(usableCrop({ x: 0.1, y: 0.05, width: 0.8, height: 0.5 })).toBe(true);
	});

	it('rejects nothing at all', () => {
		expect(usableCrop(null)).toBe(false);
		expect(usableCrop(undefined)).toBe(false);
	});

	it('rejects a box in pixels rather than fractions', () => {
		// A model that answers 0-1 nearly always, and occasionally does not.
		expect(usableCrop({ x: 0, y: 0, width: 1600, height: 900 })).toBe(false);
	});

	it('rejects a sliver', () => {
		// Cropping to 3 % of a poster produces something worse than the whole poster.
		expect(usableCrop({ x: 0.4, y: 0.4, width: 0.03, height: 0.5 })).toBe(false);
	});

	it('rejects a box that runs off the edge', () => {
		expect(usableCrop({ x: 0.7, y: 0.1, width: 0.5, height: 0.5 })).toBe(false);
	});

	it('rejects NaN, which JSON round-trips as null but arithmetic does not', () => {
		expect(usableCrop({ x: Number.NaN, y: 0, width: 0.5, height: 0.5 })).toBe(false);
	});
});

describe('fitToAspect', () => {
	const ratio = (c: { width: number; height: number }) => c.width / c.height;

	it('leaves a box that is already the right shape', () => {
		const crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 / THUMB_ASPECT };
		expect(ratio(fitToAspect(crop, SQUARE))).toBeCloseTo(THUMB_ASPECT, 5);
	});

	it('widens a tall box around its own centre, when there is room', () => {
		/*
		 * The common case: the model boxes a portrait poster's artwork. Growing around the centre
		 * keeps the subject it chose in frame, rather than anchoring at a corner and sliding off it.
		 */
		const crop = { x: 0.3, y: 0.3, width: 0.2, height: 0.2 };
		const fitted = fitToAspect(crop, SQUARE);
		expect(ratio(fitted)).toBeCloseTo(THUMB_ASPECT, 5);
		expect(fitted.x + fitted.width / 2).toBeCloseTo(crop.x + crop.width / 2, 5);
		expect(fitted.y + fitted.height / 2).toBeCloseTo(crop.y + crop.height / 2, 5);
	});

	it('slides back inside the image rather than centring off the edge', () => {
		// A box near the left edge cannot stay centred once it is widened. Staying in frame wins.
		const fitted = fitToAspect({ x: 0.3, y: 0.1, width: 0.3, height: 0.6 }, SQUARE);
		expect(ratio(fitted)).toBeCloseTo(THUMB_ASPECT, 5);
		expect(fitted.x).toBe(0);
		expect(fitted.x + fitted.width).toBeLessThanOrEqual(1.0001);
	});

	it('shortens a very wide box instead of overflowing', () => {
		const fitted = fitToAspect({ x: 0, y: 0.4, width: 1, height: 0.1 }, SQUARE);
		expect(ratio(fitted)).toBeCloseTo(THUMB_ASPECT, 5);
	});

	it('never leaves the image', () => {
		// Growing a box near an edge must slide it back in, not run past the boundary.
		for (const crop of [
			{ x: 0.85, y: 0.1, width: 0.15, height: 0.6 },
			{ x: 0, y: 0.9, width: 0.2, height: 0.1 },
			{ x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
		]) {
			const fitted = fitToAspect(crop, SQUARE);
			expect(fitted.x).toBeGreaterThanOrEqual(0);
			expect(fitted.y).toBeGreaterThanOrEqual(0);
			expect(fitted.x + fitted.width).toBeLessThanOrEqual(1.0001);
			expect(fitted.y + fitted.height).toBeLessThanOrEqual(1.0001);
		}
	});

	it('handles a full-frame box, which is the no-crop fallback', () => {
		const fitted = fitToAspect({ x: 0, y: 0, width: 1, height: 1 }, SQUARE);
		expect(ratio(fitted)).toBeCloseTo(THUMB_ASPECT, 5);
		expect(fitted.y).toBeCloseTo((1 - 1 / THUMB_ASPECT) / 2, 5);
	});
});
