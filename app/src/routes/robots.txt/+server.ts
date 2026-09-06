import { CANONICAL_HOST, SITE_ORIGIN } from '../../lib/origin.ts';
import type { RequestHandler } from './$types';

/**
 * `robots.txt`, generated rather than static, because the right answer depends on the host.
 *
 * This was a file in `static/`, which meant `dev.hendingar.no` served the same "crawl everything"
 * body as production. The `X-Robots-Tag` in hooks.server.ts already keeps those pages out of an
 * index, but a crawler that never fetches them at all is cheaper for everyone, and this is the
 * only place a `Sitemap:` line can point at the right origin.
 *
 * A `+server.ts` and not a remote function: ADR 0002 reserves these for genuinely external
 * consumers, and a crawler is the most external consumer there is.
 */
export const GET: RequestHandler = ({ url }) => {
	const body =
		url.hostname === CANONICAL_HOST
			? `# allow crawling everything by default
User-agent: *
Disallow:

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`
			: `# not the live site — see hooks.server.ts
User-agent: *
Disallow: /
`;

	return new Response(body, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
};
