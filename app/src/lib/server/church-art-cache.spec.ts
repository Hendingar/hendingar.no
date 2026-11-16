import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { artworkWidths, type Painting } from '../church-art.ts';
import {
	type ArtStore,
	churchArtCache,
	encode,
	formatFor,
	memoryStore,
	sourceName,
	storeName,
	wikimediaFetcher
} from './church-art-cache.ts';

/**
 * The cache, against a stub store and a stub Wikimedia. No network: the "source" is a picture
 * generated here, and every encode is real, because the widths it writes are the contract with
 * the srcset the page renders.
 */

const PAINTING: Painting = {
	work: 'Test',
	artist: 'Nobody',
	year: null,
	articleUrl: 'https://en.wikipedia.org/wiki/Test',
	sourceUrl: 'https://upload.wikimedia.org/test.jpg',
	file: 'test-painting',
	width: 1000,
	height: 700
};

async function source(): Promise<Uint8Array<ArrayBuffer>> {
	const { width, height } = PAINTING;
	return new Uint8Array(
		await sharp({ create: { width, height, channels: 3, background: '#8a5a2b' } })
			.jpeg()
			.toBuffer()
	);
}

function countingSource() {
	const calls: string[] = [];
	return {
		calls,
		fetch: async (url: string) => {
			calls.push(url);
			return source();
		}
	};
}

describe('encode', () => {
	it('writes each width the page asks for at exactly that width, in the format asked', async () => {
		const original = await source();
		for (const width of artworkWidths(PAINTING)) {
			for (const format of ['avif', 'webp'] as const) {
				const meta = await sharp(await encode(original, width, format)).metadata();
				expect(meta.width, `${width} ${format}`).toBe(width);
				expect(meta.format, `${width} ${format}`).toBe(format === 'avif' ? 'heif' : 'webp');
			}
		}
	});
});

describe('churchArtCache', () => {
	it('fetches a painting from Wikimedia once, however many renditions are asked for at once', async () => {
		const wikimedia = countingSource();
		const serve = churchArtCache(memoryStore(), wikimedia.fetch);
		const results = await Promise.all(
			[320, 640, 1000].flatMap((w) => [serve(PAINTING, w, 'avif'), serve(PAINTING, w, 'webp')])
		);
		expect(results.every((r) => r.kind === 'image')).toBe(true);
		expect(wikimedia.calls).toEqual([PAINTING.sourceUrl]);

		// And never again, once it is in the store.
		await serve(PAINTING, 320, 'webp');
		expect(wikimedia.calls).toHaveLength(1);
	});

	it('keeps the source, so a new process encodes a rendition without asking Wikimedia', async () => {
		const store = memoryStore();
		const first = countingSource();
		await churchArtCache(store, first.fetch)(PAINTING, 320, 'avif');
		expect(await store.get(sourceName('test-painting'))).not.toBeNull();
		// Only what was asked for was encoded.
		expect(await store.get(storeName('test-painting', 640, 'avif'))).toBeNull();

		const afterRestart = countingSource();
		const result = await churchArtCache(store, afterRestart.fetch)(PAINTING, 640, 'webp');
		expect(result.kind).toBe('image');
		expect(afterRestart.calls).toEqual([]);
	});

	it('serves from the store without touching Wikimedia when the file is there', async () => {
		const store = memoryStore();
		await store.put(
			storeName('test-painting', 320, 'avif'),
			new Uint8Array([1, 2, 3]),
			'image/avif'
		);
		const wikimedia = countingSource();
		const result = await churchArtCache(store, wikimedia.fetch)(PAINTING, 320, 'avif');
		expect(result).toEqual({
			kind: 'image',
			bytes: new Uint8Array([1, 2, 3]),
			contentType: 'image/avif'
		});
		expect(wikimedia.calls).toEqual([]);
	});

	it('sends the browser to Commons when Wikimedia fails, keeps nothing, and tries again next time', async () => {
		const store = memoryStore();
		let fail = true;
		const serve = churchArtCache(store, async () => {
			if (fail) throw new Error('429');
			return source();
		});
		expect(await serve(PAINTING, 320, 'webp')).toEqual({
			kind: 'fallback',
			url: PAINTING.sourceUrl
		});
		expect(await store.get(storeName('test-painting', 320, 'webp'))).toBeNull();

		fail = false;
		expect((await serve(PAINTING, 320, 'webp')).kind).toBe('image');
	});

	it('falls back rather than failing when the store itself is down', async () => {
		const broken: ArtStore = {
			get: async () => {
				throw new Error('storage unavailable');
			},
			put: async () => undefined
		};
		const result = await churchArtCache(broken, countingSource().fetch)(PAINTING, 320, 'webp');
		expect(result).toEqual({ kind: 'fallback', url: PAINTING.sourceUrl });
	});
});

describe('wikimediaFetcher', () => {
	it('waits as long as a 429 asks, then tries again', async () => {
		const waits: number[] = [];
		let calls = 0;
		const fetchImpl: typeof fetch = async () => {
			calls += 1;
			return calls === 1
				? new Response('slow down', { status: 429, headers: { 'retry-after': '3' } })
				: new Response(new Uint8Array([9]));
		};
		const get = wikimediaFetcher(fetchImpl, async (ms) => void waits.push(ms));
		expect(await get('https://upload.wikimedia.org/x.jpg')).toEqual(new Uint8Array([9]));
		expect(waits).toEqual([3000]);
	});

	it('gives up after three tries, and does not retry a 404', async () => {
		let calls = 0;
		const always =
			(status: number): typeof fetch =>
			async () => {
				calls += 1;
				return new Response('', { status });
			};
		await expect(wikimediaFetcher(always(503), async () => undefined)('u')).rejects.toThrow('503');
		expect(calls).toBe(3);
		calls = 0;
		await expect(wikimediaFetcher(always(404), async () => undefined)('u')).rejects.toThrow('404');
		expect(calls).toBe(1);
	});

	it('sends one request at a time, so a cold listing is not a burst', async () => {
		let open = 0;
		let most = 0;
		const fetchImpl: typeof fetch = async () => {
			open += 1;
			most = Math.max(most, open);
			await new Promise((r) => setTimeout(r, 5));
			open -= 1;
			return new Response(new Uint8Array([1]));
		};
		const get = wikimediaFetcher(fetchImpl);
		await Promise.all(['a', 'b', 'c', 'd'].map((u) => get(u)));
		expect(most).toBe(1);
	});
});

describe('formatFor', () => {
	it('sends AVIF only to a browser that says it takes it', () => {
		expect(formatFor('image/avif,image/webp,image/apng,image/*,*/*;q=0.8')).toBe('avif');
		expect(formatFor('image/webp,*/*')).toBe('webp');
		expect(formatFor('*/*')).toBe('webp');
		expect(formatFor(null)).toBe('webp');
	});
});
