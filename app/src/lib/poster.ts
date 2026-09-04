/**
 * Cropping a poster to a card thumbnail, in the browser.
 *
 * The crop box comes from the model that read the poster — it has already looked at the image and
 * knows where the picture is and where the small print is. Applying it here rather than on the
 * server means no image library in the app, no image processing on a 0.25 vCPU container, and no
 * copy of the photograph on our side for an event that turns out not to be published.
 *
 * Best effort throughout. A missing, malformed or absurd box means no crop, never a broken image.
 */

export type Crop = { x: number; y: number; width: number; height: number };

/** Wider than tall, because an event card is. Matches the aspect the tiles reserve. */
export const THUMB_ASPECT = 16 / 10;

/** Enough for a retina card, small enough that nobody waits for it. */
export const THUMB_WIDTH = 960;

export const THUMB_QUALITY = 0.82;

/**
 * Is this a box we can actually use?
 *
 * The model is asked for fractions and generally gives them, but a model that returns pixels, or a
 * sliver, or a box running off the edge would produce a thumbnail worse than the uncropped image.
 * Rejecting is the honest outcome — the caller falls back to the whole picture.
 */
export function usableCrop(crop: Crop | null | undefined): crop is Crop {
	if (!crop) return false;
	const values = [crop.x, crop.y, crop.width, crop.height];
	if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
	if (crop.width <= 0.1 || crop.height <= 0.1) return false;
	if (crop.x < 0 || crop.y < 0) return false;
	if (crop.x + crop.width > 1.001 || crop.y + crop.height > 1.001) return false;
	return true;
}

/**
 * Widen a crop to the card's aspect, staying inside the image.
 *
 * The model is asked for something wider than tall and does not always oblige. Rather than
 * discarding a good box for being the wrong shape, this grows it around its own centre and then
 * slides it back inside the edges — so the subject the model chose stays in frame.
 *
 * `imageAspect` is the source image's own width ÷ height, and it is not optional detail. The box is
 * in *fractions* of the image, so a fraction-box of 1.0 × 0.625 on a 400 × 1000 poster is 400 × 625
 * pixels — portrait, not the 16:10 it looks like on paper. Leaving it out produced exactly that:
 * every crop came out sideways, and only a test that decoded the actual JPEG could see it.
 */
export function fitToAspect(crop: Crop, imageAspect: number, aspect = THUMB_ASPECT): Crop {
	// The aspect to hit in fraction space, so that the result is `aspect` in pixels.
	const target = aspect / imageAspect;
	/*
	 * Pick the width first, then derive the height from it.
	 *
	 * The first version adjusted whichever dimension was "wrong" and clamped it to the image, which
	 * silently did nothing when the box was already full width — a full-frame fallback came back
	 * square instead of landscape, and every uncropped poster was squeezed into the tile. Deriving
	 * one side from the other cannot fail that way: the result is always exactly the aspect asked
	 * for, and only its position is negotiable.
	 */
	let width = Math.min(1, Math.max(crop.width, crop.height * target));
	let height = width / target;

	// A very tall target (a wide image cropped to a wider card) can overflow vertically instead.
	if (height > 1) {
		height = 1;
		width = target;
	}

	// Centre on what the model chose, then slide back inside the image. Near an edge the centre
	// moves — keeping the subject in frame matters more than keeping it exactly centred.
	const centreX = crop.x + crop.width / 2;
	const centreY = crop.y + crop.height / 2;

	return {
		x: Math.max(0, Math.min(1 - width, centreX - width / 2)),
		y: Math.max(0, Math.min(1 - height, centreY - height / 2)),
		width,
		height
	};
}

/**
 * Draw the crop and re-encode as JPEG.
 *
 * Re-encoding rather than slicing the original bytes is what strips the metadata a second time:
 * the capture path already removes EXIF, and a canvas cannot carry it through even if something
 * upstream changed.
 */
export async function cropToThumbnail(
	dataUrl: string,
	crop: Crop | null | undefined
): Promise<Blob | null> {
	const image = new Image();
	image.src = dataUrl;
	try {
		await image.decode();
	} catch {
		return null;
	}

	const imageAspect = image.naturalWidth / image.naturalHeight;
	const box = usableCrop(crop)
		? fitToAspect(crop, imageAspect)
		: // No usable box: take a centred band of the whole image at the card's aspect, which is
			// still better than a portrait poster squeezed into a landscape tile.
			fitToAspect({ x: 0, y: 0, width: 1, height: 1 }, imageAspect);

	const sx = box.x * image.naturalWidth;
	const sy = box.y * image.naturalHeight;
	const sw = box.width * image.naturalWidth;
	const sh = box.height * image.naturalHeight;

	const width = Math.min(THUMB_WIDTH, Math.round(sw));
	const height = Math.round(width / (sw / sh));

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) return null;
	context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);

	return new Promise((resolve) =>
		canvas.toBlob((blob) => resolve(blob), 'image/jpeg', THUMB_QUALITY)
	);
}
