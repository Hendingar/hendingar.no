/**
 * Page analytics, through d8a's server-side collector.
 *
 * A GA4-compatible tracker that reports to `global.t.d8a.tech` rather than to Google directly.
 * That is a smaller disclosure than gtag.js — no Google-owned script runs in the page, and the
 * collector is the only third party a visitor's browser talks to — but it is still a third party
 * receiving a page view and an IP, so the README no longer claims otherwise.
 *
 * ## Only on the real site
 *
 * Gated on the hostname, not on a build flag. Without that every `pnpm dev`, every preview server
 * and all ninety-odd end-to-end tests would report page views, which would make the numbers useless
 * for exactly the question they exist to answer. A build flag would work too and would be one more
 * thing to get wrong in an environment file; the hostname cannot be misconfigured.
 */

const MEASUREMENT_ID = '05801cfd-cf47-4892-9a2a-b301f6b2c429';
const COLLECTOR = `https://global.t.d8a.tech/${MEASUREMENT_ID}/d/c`;

/** The hosts that are the live site. Anything else — localhost, a preview, CI — reports nothing. */
const LIVE_HOSTS = new Set(['hendingar.no', 'www.hendingar.no']);

export function shouldTrack(hostname: string): boolean {
	return LIVE_HOSTS.has(hostname);
}

let started = false;

/**
 * Start reporting, once.
 *
 * Idempotent because the layout effect it runs from can re-run, and a second `installD8a()` would
 * leave two trackers double-counting every page.
 *
 * Deliberately quiet on failure. Analytics is the least important thing on the page: a blocked
 * request, an extension that removes the script, or a collector that is down must cost the reader
 * nothing at all.
 */
export async function startAnalytics(hostname: string): Promise<void> {
	if (started || !shouldTrack(hostname)) return;
	started = true;

	try {
		const { installD8a } = await import('@d8a-tech/wt');
		installD8a();

		const d8a = window.d8a;
		if (!d8a) return;

		d8a('js', new Date());
		d8a('config', MEASUREMENT_ID, { server_container_url: COLLECTOR });
	} catch {
		// See above: never the reader's problem.
	}
}
