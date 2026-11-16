import { ALL_IMAGES, artworkWidths, type ChurchImage } from '../church-art.ts';
import {
	churchArtCache,
	memoryStore,
	warmChurchArt,
	wikimediaFetcher,
	type ArtStore
} from './church-art-cache.ts';
import { posterStorageEnabled, readStoredFile, storedFileExists, storeFile } from './posters.ts';

/**
 * The process's one church-art cache, shared by the image route, the share card and the warmer —
 * one cache, so its in-flight maps and its encode queue cover all three.
 */
const store: ArtStore = posterStorageEnabled()
	? { get: readStoredFile, has: storedFileExists, put: storeFile }
	: memoryStore();

export const serveChurchArt = churchArtCache(store, wikimediaFetcher());

/** Long enough that a fresh revision has passed its readiness probe and served its first pages. */
const WARM_DELAY_MS = 60_000;
/** Between encodes, so a page request always finds the CPU free soon. */
const WARM_PAUSE_MS = 1_000;

let warming = false;

/**
 * Encode, in the background, every rendition nobody has asked for yet. Only against blob storage:
 * an in-memory store would spend a dev server's first minutes encoding pictures nobody will see.
 */
export function startChurchArtWarmer(): void {
	if (warming || !posterStorageEnabled()) return;
	warming = true;
	const timer = setTimeout(() => {
		warmChurchArt(
			serveChurchArt,
			store,
			ALL_IMAGES,
			artworkWidths,
			() => new Promise((r) => setTimeout(r, WARM_PAUSE_MS))
		)
			.then(({ made, failed }) => console.info(`church-art: warmed ${made}, failed ${failed}`))
			.catch((error) => console.error('church-art: warming stopped', error));
	}, WARM_DELAY_MS);
	// Never what keeps a process alive — a build that loads the hooks must still exit.
	timer.unref();
}

/**
 * The painting for a share card, as a data URL resvg can draw, or null.
 *
 * From the largest stored rendition, cropped to the card here: resvg reads neither AVIF nor WebP,
 * so it gets a JPEG, and one already 1200×630 costs it nothing to scale. Bounded in time like a
 * poster fetch — a scraper is waiting, and the card without the painting is still a card.
 */
export async function churchArtForCard(
	painting: ChurchImage,
	size: { width: number; height: number }
): Promise<string | null> {
	const width = artworkWidths(painting).at(-1);
	if (width === undefined) return null;
	const work = async () => {
		const result = await serveChurchArt(painting, width, 'webp');
		if (result.kind !== 'image') return null;
		const { default: sharp } = await import('sharp');
		const jpeg = await sharp(result.bytes)
			.resize({ ...size, fit: 'cover', position: 'attention' })
			.jpeg({ quality: 80 })
			.toBuffer();
		return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
	};
	const deadline = new Promise<null>((r) => setTimeout(() => r(null), 4_000).unref());
	try {
		return await Promise.race([work(), deadline]);
	} catch (error) {
		console.error(`church-art: no card picture for ${painting.file}`, error);
		return null;
	}
}
