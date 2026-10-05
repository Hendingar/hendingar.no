// `Handle` moved to this subpath in SvelteKit 3 — it is not on the root export any more.
import type { Handle } from '@sveltejs/kit/hooks';
import { CANONICAL_HOST, SITE_ORIGIN } from './lib/origin.ts';
import { allow, TOO_MANY } from './lib/server/limits.ts';

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

	/*
	 * A floor under every write, before any of it runs.
	 *
	 * The expensive routes have tighter limits of their own (`server/limits.ts`). This one is for
	 * whatever is added next and forgotten, and for remote functions, whose URLs are opaque — a
	 * script that has found one should meet a limit without anybody having remembered to add it.
	 */
	if (!SAFE_METHODS.has(event.request.method) && !allow('post', event)) {
		return new Response(TOO_MANY, {
			status: 429,
			headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60' }
		});
	}

	const response = await resolve(event);

	if (hostname !== CANONICAL_HOST) {
		response.headers.set('x-robots-tag', 'noindex, nofollow');
	}

	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!response.headers.has(name)) response.headers.set(name, value);
	}

	return response;
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The headers every response carries. The Content-Security-Policy is not here: SvelteKit writes it
 * (vite.config.ts), because only SvelteKit knows the nonce on its own hydration script.
 *
 * - `nosniff`, because `/ko/[id]/bilete` stores bytes a stranger sent and the blob is served back;
 *   a browser must never guess that a "JPEG" is HTML.
 * - Frame denial twice over: `frame-ancestors` in the CSP for browsers that read it, the old header
 *   for those that do not. Nothing here is meant to be embedded, and the forms are worth clickjacking.
 * - The referrer is cut to the origin when a reader follows a link out to a source, so a source
 *   learns that somebody came from hendingar.no, not which `/ko` page or search they were on.
 * - HSTS without `includeSubDomains`: every host we serve is HTTPS already, and a subdomain somebody
 *   points somewhere else later should not inherit a year-long promise from this one.
 */
const SECURITY_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'cross-origin-opener-policy': 'same-origin',
	'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
	'strict-transport-security': 'max-age=31536000'
};
