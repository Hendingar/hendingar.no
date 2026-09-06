import { renderOgImage } from '../../lib/server/og-image.ts';
import type { RequestHandler } from './$types';

/**
 * The site's own share card — what a link to `/`, `/hendingar` or any page that is not one event
 * shows when it is pasted somewhere.
 *
 * The same drawing as an event's card, so the two read as one site rather than as a template and
 * an exception. Rendered rather than committed as a file: there is then one place the design
 * lives, and no binary in the repo to fall out of date with `brand.css`.
 */
export const GET: RequestHandler = async () => {
	const png = await renderOgImage({
		// The places we actually cover, not the wordmark — that is already in the corner, and
		// naming the bygdene is the more useful thing for somebody deciding whether this is theirs.
		label: 'Stord · Bømlo · Fitjar',
		title: 'Kva skjer i Sunnhordland',
		primary: 'Lokale kalendrar, samla i éi liste',
		secondary: 'Gratis, utan reklame',
		posterUrl: null
	});

	return new Response(png, {
		headers: {
			'content-type': 'image/png',
			// This one never changes between deploys, so it can be cached hard.
			'cache-control': 'public, max-age=604800'
		}
	});
};
