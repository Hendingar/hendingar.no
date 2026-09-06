// `Handle` moved to this subpath in SvelteKit 3 — it is not on the root export any more.
import type { Handle } from '@sveltejs/kit/hooks';
import { CANONICAL_HOST, SITE_ORIGIN } from './lib/origin.ts';

/**
 * One indexable origin, enforced at the edge of the app.
 *
 * `hendingar.no`, `www.hendingar.no` and `dev.hendingar.no` are all bound to the same container
 * app (infra/app.bicep), so all three served the same pages with the same permissive robots.txt.
 * A search engine reading that finds one site three times and has to guess which is the original;
 * a reader who lands on the dev host sees production data on a URL we do not want shared.
 *
 * Two rules, in this order:
 *
 * 1. `www` redirects to the apex, permanently. 308 rather than 301 because it preserves the
 *    method — a form POST to `www` would otherwise silently become a GET and lose its body.
 * 2. Anything that is not the apex is marked `noindex`. That covers `dev`, the raw
 *    `*.azurecontainerapps.io` FQDN that Container Apps always answers on, and any hostname bound
 *    in future before anyone remembers this file — which is the point of a default rather than a
 *    list. `X-Robots-Tag` rather than a meta tag so it also covers the sitemap, the `.ics` files
 *    and anything else that is not HTML.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const { hostname, pathname, search } = event.url;

	if (hostname === `www.${CANONICAL_HOST}`) {
		return new Response(null, {
			status: 308,
			headers: { location: `${SITE_ORIGIN}${pathname}${search}` }
		});
	}

	const response = await resolve(event);

	if (hostname !== CANONICAL_HOST) {
		response.headers.set('x-robots-tag', 'noindex, nofollow');
	}

	return response;
};
