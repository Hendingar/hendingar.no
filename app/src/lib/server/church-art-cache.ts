import type { Sharp } from 'sharp';
import { CHURCH_ART_VERSION, type Painting } from '../church-art.ts';

/**
 * The church paintings, fetched from Wikimedia once and kept.
 *
 * The browser asks us for `/church-art/v1/<file>-<width>`. The first request for a painting
 * fetches its `sourceUrl` from Wikimedia and keeps that source in the store; it is the only time
 * anything here talks to Wikimedia about that painting, across restarts and deploys. Each
 * rendition is encoded from the stored source the first time somebody asks for it, kept, and
 * served from the store ever after. See church-art.ts for why hotlinking was not an option.
 *
 * - **One fetch, one encode.** Concurrent requests share the work in flight: six requests for one
 *   painting (three widths, from a tile and a page at once) make one Wikimedia fetch, and two
 *   requests for the same rendition make one encode.
 * - **One Wikimedia request at a time.** A cold cache after a deploy meets a listing of a dozen
 *   paintings at once — the exact burst that got 429s when browsers sent it. Queued, with the
 *   wait Wikimedia asks for when it does say 429.
 * - **Only what is asked for.** A request encodes its own rendition and no other, so the first
 *   visitor waits for one encode (about a second at the largest size), not six.
 * - **A failure costs one picture, briefly.** If Wikimedia or the store cannot be reached, the
 *   browser is sent to the Commons file directly, with nothing cached, so the next visit tries
 *   again. Never a broken image, and never a bad file kept forever.
 */

/** Bytes on their own buffer: what `Response` takes, and what a copy out of a shared pool is. */
type Bytes = Uint8Array<ArrayBuffer>;

export type Format = 'avif' | 'webp';
export const CONTENT_TYPES: Record<Format, string> = { avif: 'image/avif', webp: 'image/webp' };

/**
 * Settings chosen by measurement, on five of the paintings at 320, 640 and 1100 wide. Against a
 * JPEG at 85, AVIF at 50 is 62% smaller and WebP at 70 is 34% smaller, with no difference visible
 * side by side at 2×. AVIF effort 2 rather than the default 4: the default took 17 seconds for one
 * painting's three widths, and 2 took under two and came out no larger. WebP is only for browsers
 * that cannot show AVIF.
 */
const ENCODE: Record<Format, (image: Sharp) => Sharp> = {
	avif: (image) => image.avif({ quality: 50, effort: 2 }),
	webp: (image) => image.webp({ quality: 70, effort: 4, smartSubsample: true })
};

export type ArtStore = {
	get(name: string): Promise<Bytes | null>;
	put(name: string, bytes: Bytes, contentType: string): Promise<void>;
};

export type FetchSource = (url: string) => Promise<Bytes>;

export type ArtResult =
	{ kind: 'image'; bytes: Bytes; contentType: string } | { kind: 'fallback'; url: string };

/** The format to send: AVIF where the browser says it takes it, WebP everywhere else. */
export function formatFor(accept: string | null): Format {
	return accept?.includes('image/avif') ? 'avif' : 'webp';
}

export function storeName(file: string, width: number, format: Format): string {
	return `church-art/${CHURCH_ART_VERSION}/${file}-${width}.${format}`;
}

/** Where the Wikimedia original is kept, so it is never fetched a second time. */
export function sourceName(file: string): string {
	return `church-art/${CHURCH_ART_VERSION}/${file}.source`;
}

/**
 * One rendition, from the source bytes. Pure apart from the CPU it takes.
 *
 * `sharp` is a native module, imported here rather than at the top: if its binary failed to load
 * in a container, a top-level import would take the whole route down with it, and the fallback
 * to Commons below would never get the chance to run.
 */
export async function encode(source: Bytes, width: number, format: Format): Promise<Bytes> {
	const { default: sharp } = await import('sharp');
	const image = sharp(source).resize({ width, withoutEnlargement: true });
	return new Uint8Array(await ENCODE[format](image).toBuffer());
}

/**
 * Wikimedia, one request at a time, with the backoff it asks for.
 *
 * A User-Agent that names us, as Wikimedia's policy asks of anything automated.
 */
export function wikimediaFetcher(
	fetchImpl: typeof fetch = fetch,
	wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): FetchSource {
	let queue: Promise<unknown> = Promise.resolve();
	return (url) => {
		const run = async (): Promise<Bytes> => {
			for (let attempt = 0; ; attempt++) {
				const response = await fetchImpl(url, {
					headers: { 'user-agent': 'hendingar.no/1.0 (https://hendingar.no; church-art cache)' }
				});
				if (response.ok) return new Uint8Array(await response.arrayBuffer());
				const retryable = response.status === 429 || response.status >= 500;
				if (!retryable || attempt >= 2) {
					throw new Error(`Wikimedia answered ${response.status} for ${url}`);
				}
				const asked = Number(response.headers.get('retry-after'));
				await wait(Math.min(Number.isFinite(asked) && asked > 0 ? asked * 1000 : 2000, 10_000));
			}
		};
		const result = queue.then(run, run);
		queue = result.catch(() => undefined);
		return result;
	};
}

/** Work in flight, shared by everyone who asks for the same key while it runs. */
function onceAtATime<T>() {
	const running = new Map<string, Promise<T>>();
	return (key: string, work: () => Promise<T>): Promise<T> => {
		const existing = running.get(key);
		if (existing) return existing;
		const job = work();
		running.set(key, job);
		// Forgotten either way: a success is in the store now, and a failure should be retried.
		const forget = () => void running.delete(key);
		job.then(forget, forget);
		return job;
	};
}

/** The cache. One per process: the in-flight maps are what make six requests one fetch. */
export function churchArtCache(store: ArtStore, fetchSource: FetchSource) {
	const sources = onceAtATime<Bytes>();
	const renditions = onceAtATime<Bytes>();

	function source(painting: Painting): Promise<Bytes> {
		return sources(painting.file, async () => {
			const name = sourceName(painting.file);
			const kept = await store.get(name);
			if (kept) return kept;
			const fetched = await fetchSource(painting.sourceUrl);
			await store.put(name, fetched, 'application/octet-stream');
			return fetched;
		});
	}

	return async function serve(
		painting: Painting,
		width: number,
		format: Format
	): Promise<ArtResult> {
		const name = storeName(painting.file, width, format);
		const contentType = CONTENT_TYPES[format];
		try {
			const bytes = await renditions(name, async () => {
				const stored = await store.get(name);
				if (stored) return stored;
				const encoded = await encode(await source(painting), width, format);
				await store.put(name, encoded, contentType);
				return encoded;
			});
			return { kind: 'image', bytes, contentType };
		} catch (error) {
			console.error(`church-art: ${name} could not be served`, error);
			return { kind: 'fallback', url: painting.sourceUrl };
		}
	};
}

/** Without blob storage — local development, CI — the process keeps them itself. */
export function memoryStore(): ArtStore {
	const files = new Map<string, Bytes>();
	return {
		get: async (name) => files.get(name) ?? null,
		put: async (name, bytes) => void files.set(name, bytes)
	};
}
