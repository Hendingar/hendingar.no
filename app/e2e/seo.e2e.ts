import { expect, test } from '@playwright/test';

/**
 * The parts of the site only a crawler reads.
 *
 * None of this is visible on a page, which is exactly why it needs a spec: a missing sitemap or a
 * canonical that quietly went back to pointing at itself looks identical to a working site in a
 * browser, and only shows up as traffic that never arrives.
 */

test('robots.txt names the sitemap and allows crawling', async ({ request }) => {
	const response = await request.get('/robots.txt');
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('text/plain');

	const body = await response.text();
	// Locally the host is not the live one, so the guard in the route serves the "stay out" body.
	// Both branches must name their rule explicitly rather than answering with an empty file.
	expect(body).toMatch(/^User-agent: \*$/m);
	expect(body).toMatch(/^Disallow:/m);
});

test('the sitemap is well-formed and reaches the event pages', async ({ request }) => {
	const response = await request.get('/sitemap.xml');
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('xml');

	const body = await response.text();
	expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

	const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
	expect(locs.length).toBeGreaterThan(10);

	// The whole point: `/hendingar` pages with a button, not with URLs, so before this the only
	// events a crawler could reach were the two dozen on the first screen.
	const events = locs.filter((loc) => /\/hending\/\d+/.test(loc));
	expect(events.length, 'the sitemap should list event pages').toBeGreaterThan(0);

	// Absolute URLs, and no unescaped ampersand — `?kategori=` entries are the ones that would
	// break the XML if the escaping were dropped.
	for (const loc of locs) expect(loc).toMatch(/^https?:\/\//);
	expect(body).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#)/);
});

test('every indexable page declares one canonical URL', async ({ request, baseURL }) => {
	const paths = [
		'/',
		'/hendingar',
		'/hendingar?kategori=musikk',
		'/kalender',
		'/datasamling',
		'/send-inn',
		'/poppis/hjarta',
		'/poppis/vist'
	];

	for (const path of paths) {
		const html = await (await request.get(path)).text();
		const hrefs = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
		expect(hrefs, `${path} should declare exactly one canonical`).toHaveLength(1);
		expect(hrefs[0], path).toMatch(/^https?:\/\//);
	}

	// A source filter is a view of the listing, not a page of its own — it must not ask to be
	// indexed separately, or the same events compete with themselves under a dozen URLs.
	const filtered = await (
		await request.get('/hendingar?kategori=musikk&kjelde=stord-kulturhus')
	).text();
	const canonical = /<link rel="canonical" href="([^"]+)"/.exec(filtered)?.[1];
	expect(canonical).toBe(new URL('/hendingar?kategori=musikk', baseURL).href);
});

test('pages we do not want indexed say so, and have no canonical', async ({ request }) => {
	for (const path of ['/hjarta', '/ko']) {
		const html = await (await request.get(path)).text();
		expect(html, path).toContain('name="robots"');
		expect(html, path).toContain('noindex');
		expect(html, path).not.toContain('rel="canonical"');
	}
});
