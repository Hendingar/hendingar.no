import { describe, expect, it } from 'vitest';
import { THUMB_ASPECT, cropToThumbnail } from './poster.ts';

/**
 * The canvas path, in a real browser.
 *
 * `fitToAspect` and `usableCrop` are pure and tested in poster.spec.ts under node. This is the part
 * that cannot be: decoding an image, drawing a sub-rectangle of it, and re-encoding as JPEG. It
 * runs in the `client` vitest project, which is Chromium via Playwright.
 */

/** A tall image with a distinct band top and bottom, so a wrong crop is visible in the pixels. */
async function tallTestImage(): Promise<string> {
	const canvas = document.createElement('canvas');
	canvas.width = 400;
	canvas.height = 1000;
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#16223b';
	ctx.fillRect(0, 0, 400, 1000);
	// The subject: a peach block across the upper third, where a poster's artwork lives.
	ctx.fillStyle = '#f7a98a';
	ctx.fillRect(0, 100, 400, 250);
	return canvas.toDataURL('image/png');
}

async function decode(blob: Blob) {
	const bitmap = await createImageBitmap(blob);
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
	return { bitmap, canvas };
}

describe('cropToThumbnail', () => {
	it('produces a landscape JPEG from a portrait poster', async () => {
		const blob = await cropToThumbnail(await tallTestImage(), {
			x: 0,
			y: 0.1,
			width: 1,
			height: 0.25
		});
		expect(blob).not.toBeNull();
		expect(blob!.type).toBe('image/jpeg');

		const { bitmap } = await decode(blob!);
		// The card wants landscape; the source was 400×1000.
		expect(bitmap.width / bitmap.height).toBeCloseTo(THUMB_ASPECT, 1);
		expect(bitmap.width).toBeGreaterThan(bitmap.height);
	});

	it('keeps the part the model pointed at, not the middle of the poster', async () => {
		/*
		 * The whole reason the model is asked for a box. A centred crop of a portrait poster takes
		 * the small print and drops the artwork; this asserts the artwork survives.
		 */
		const blob = await cropToThumbnail(await tallTestImage(), {
			x: 0,
			y: 0.1,
			width: 1,
			height: 0.25
		});
		const { canvas, bitmap } = await decode(blob!);
		const middle = canvas
			.getContext('2d')!
			.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data;
		// Peach (#f7a98a), not navy — the subject, not the background.
		expect(middle[0]).toBeGreaterThan(200);
		expect(middle[2]).toBeLessThan(180);
	});

	it('falls back to a centred band when the box is nonsense', async () => {
		// A model that answers in pixels, or a sliver: better no crop than a bad one.
		const blob = await cropToThumbnail(await tallTestImage(), {
			x: 0,
			y: 0,
			width: 4000,
			height: 9000
		});
		expect(blob).not.toBeNull();
		const { bitmap } = await decode(blob!);
		expect(bitmap.width / bitmap.height).toBeCloseTo(THUMB_ASPECT, 1);
	});

	it('returns null rather than throwing on something that is not an image', async () => {
		expect(await cropToThumbnail('data:image/png;base64,bm90YW5pbWFnZQ==', null)).toBeNull();
	});
});
