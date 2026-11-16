import { error, redirect } from '@sveltejs/kit';
import { artworkForFileName, CHURCH_ART_VERSION } from '../../../../lib/church-art.ts';
import {
	churchArtCache,
	formatFor,
	memoryStore,
	wikimediaFetcher
} from '../../../../lib/server/church-art-cache.ts';
import { posterStorageEnabled, readStoredFile, storeFile } from '../../../../lib/server/posters.ts';
import type { RequestHandler } from './$types';

/**
 * One rendition of a church painting. The cache and its reasoning: lib/server/church-art-cache.ts.
 */
const serve = churchArtCache(
	posterStorageEnabled() ? { get: readStoredFile, put: storeFile } : memoryStore(),
	wikimediaFetcher()
);

export const GET: RequestHandler = async ({ params, request }) => {
	const found = params.version === CHURCH_ART_VERSION ? artworkForFileName(params.name) : null;
	if (!found) error(404, 'Ukjent bilete');

	const result = await serve(found.painting, found.width, formatFor(request.headers.get('accept')));
	if (result.kind === 'fallback') {
		// Not cached by the browser: the next visit should try our copy again.
		redirect(302, result.url);
	}
	return new Response(result.bytes, {
		headers: {
			'content-type': result.contentType,
			'cache-control': 'public, max-age=31536000, immutable',
			// The same address is AVIF to one browser and WebP to another.
			vary: 'Accept'
		}
	});
};
