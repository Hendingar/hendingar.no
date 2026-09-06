/**
 * The one origin this site is indexed under.
 *
 * Three hostnames answer today — `hendingar.no`, `www.hendingar.no` and `dev.hendingar.no` — all
 * bound to the same container app, all returning 200, and until now all telling a crawler they
 * were the original. That is the same page indexed three times, competing with itself.
 *
 * A constant rather than an environment variable, deliberately. The DNS zone lives at one.com and
 * is not in Bicep (infra/BOOTSTRAP.md), so nothing deploys a new domain without a human editing
 * records by hand; a variable would imply a knob that does not exist, and there are no public
 * env vars in this app at all. The precedent is `LIVE_HOSTS` below, which analytics.ts has used
 * as a hostname gate since the tracker landed.
 */
export const CANONICAL_HOST = 'hendingar.no';

export const SITE_ORIGIN = `https://${CANONICAL_HOST}`;

/**
 * The hosts that are the live site.
 *
 * `dev.hendingar.no` is deliberately absent: it serves the same code from the same database, and
 * neither analytics nor search should treat it as production.
 */
export const LIVE_HOSTS = new Set([CANONICAL_HOST, `www.${CANONICAL_HOST}`]);

/**
 * The absolute URL a page should name as its canonical.
 *
 * Live hosts collapse to the apex, so `www` and the apex agree on one address. Everywhere else —
 * localhost, a preview, the raw `*.azurecontainerapps.io` FQDN — keeps its own origin, because a
 * canonical pointing at production from a developer's laptop is a lie that is hard to notice and
 * would send the end-to-end suite chasing the live site.
 *
 * `path` is passed explicitly rather than taken from the request, because which query parameters
 * belong in a canonical is a per-route decision: `/kalender?maanad=2026-10` is a different page,
 * `/hendingar?kjelde=x` is a filtered view of one.
 */
export function canonicalUrl(
	// Structural rather than `URL`, because `page.url` is a readonly view of one — this needs two
	// strings and no more.
	requestUrl: { hostname: string; origin: string },
	path: string
): string {
	return new URL(path, originFor(requestUrl)).href;
}

/**
 * Just the origin, with no trailing slash — what a schema.org `@id` is built from.
 *
 * `canonicalUrl(url, '/')` would give one with a slash, and `https://hendingar.no/#website` and
 * `https://hendingar.no#website` are different identifiers to a consumer that compares strings.
 */
export function originFor(requestUrl: { hostname: string; origin: string }): string {
	return LIVE_HOSTS.has(requestUrl.hostname) ? SITE_ORIGIN : requestUrl.origin;
}
