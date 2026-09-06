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
		'/neste-helg',
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

/**
 * What a pasted link looks like.
 *
 * ADR 0011 names the shape of our traffic — "that person almost always arrives from a shared
 * link, once, on a phone" — and until recently such a link arrived as a line of grey text. None of
 * this is visible in a browser, so nothing but a spec notices when it goes.
 */

const OG_REQUIRED = [
	'og:site_name',
	'og:locale',
	'og:type',
	'og:url',
	'og:title',
	'og:description',
	'og:image',
	'og:image:width',
	'og:image:height',
	'og:image:alt'
];

function meta(html: string, key: string): string | undefined {
	const property = new RegExp(`<meta property="${key}" content="([^"]*)"`).exec(html)?.[1];
	return property ?? new RegExp(`<meta name="${key}" content="([^"]*)"`).exec(html)?.[1];
}

test('every indexable page carries a full share card', async ({ request }) => {
	for (const path of ['/', '/hendingar', '/neste-helg', '/kalender', '/datasamling', '/send-inn']) {
		const html = await (await request.get(path)).text();

		for (const key of OG_REQUIRED) {
			expect(meta(html, key), `${path} is missing ${key}`).toBeTruthy();
		}
		// Not only for X: Slack and others read this to choose between a thumbnail and a full-width
		// image, and fall back to the small one without it.
		expect(meta(html, 'twitter:card'), path).toBe('summary_large_image');

		// og:url and the canonical must agree. Two different answers to "where does this live" is
		// worse than one wrong one.
		const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
		expect(meta(html, 'og:url'), path).toBe(canonical);
	}
});

test('an event points its card at its own generated image', async ({ request }) => {
	const listing = await (await request.get('/hendingar')).text();
	const href = /href="(\/hending\/\d+[^"]*)"/.exec(listing)?.[1];
	expect(href).toBeTruthy();

	const html = await (await request.get(href!)).text();
	expect(meta(html, 'og:type')).toBe('article');
	const image = meta(html, 'og:image');
	expect(image).toContain(`${href}/og.png`);

	// The calendar file is announced, not only linked: a calendar client handed this page looks
	// for the alternate rather than for an anchor.
	expect(html).toContain('type="text/calendar"');
});

test('every event has a picture, poster or not', async ({ request }) => {
	/*
	 * The whole reason this route exists. `og:image` used to be emitted only when an event carried
	 * a poster, and the main source marks every one of its posters rights-unverified — so most
	 * shares had no image at all. Both cases are asserted, because the posterless one is the one
	 * that regresses silently.
	 */
	const listing = await (await request.get('/hendingar')).text();
	const paths = [...listing.matchAll(/href="(\/hending\/\d+[^"]*)"/g)].map((m) => m[1]);
	expect(paths.length).toBeGreaterThan(1);

	for (const path of [...new Set(paths)].slice(0, 3)) {
		const response = await request.get(`${path}/og.png`);
		expect(response.status(), path).toBe(200);
		expect(response.headers()['content-type'], path).toBe('image/png');

		const body = await response.body();
		// The PNG magic number. A 200 carrying an HTML error page would pass a status check.
		expect([...body.subarray(0, 4)], path).toEqual([0x89, 0x50, 0x4e, 0x47]);
		expect(body.byteLength, path).toBeGreaterThan(5_000);
	}
});

test('the site has a card of its own, and a missing event has none', async ({ request }) => {
	const site = await request.get('/og.png');
	expect(site.status()).toBe(200);
	expect(site.headers()['content-type']).toBe('image/png');
	expect([...(await site.body()).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

	for (const path of ['/hending/99999999/og.png', '/hending/abc/og.png']) {
		expect((await request.get(path)).status(), path).toBe(404);
	}
});

/**
 * What the JSON-LD actually claims.
 *
 * The old block, live, said `"url": "https://sunnhordland.museum.no/…"` on a page whose canonical
 * pointed at us — two contradictory answers to "where does this event live". Nothing in a browser
 * shows that, and nothing but a spec notices it coming back.
 */

function jsonLdBlocks(html: string): Record<string, unknown>[] {
	return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
		JSON.parse(m[1]!.replace(/<\\\//g, '</'))
	);
}

test('an event describes itself, and points at itself', async ({ request }) => {
	const listing = await (await request.get('/hendingar')).text();
	const href = /href="(\/hending\/\d+[^"]*)"/.exec(listing)?.[1];
	expect(href).toBeTruthy();

	const html = await (await request.get(href!)).text();
	const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
	const blocks = jsonLdBlocks(html);

	const event = blocks.find((b) => b['@type'] === 'Event');
	expect(event, 'the event page must carry an Event node').toBeTruthy();

	// The fix. `url` and `@id` are us; an outbound link belongs in offers, a source page in sameAs.
	expect(event!.url).toBe(canonical);
	expect(event!['@id']).toBe(canonical);

	// Google's required trio, plus the offset it asks for rather than a bare Z.
	expect(event!.name).toBeTruthy();
	expect(String(event!.startDate)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
	expect(event!.location).toBeTruthy();

	expect(event!.eventStatus).toBe('https://schema.org/EventScheduled');
	expect(event!.inLanguage).toBe('nn');

	// No markup anywhere in what we publish about it.
	expect(JSON.stringify(event)).not.toMatch(/<\/?(p|strong|em|br|div|a)[ >]/);

	const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList');
	expect(crumbs, 'the event page must carry a breadcrumb').toBeTruthy();
});

test('the front page says who we are, and a listing says it is a list', async ({ request }) => {
	const front = jsonLdBlocks(await (await request.get('/')).text());
	const graph = front.find((b) => Array.isArray(b['@graph']));
	expect(graph, 'the front page must carry the site graph').toBeTruthy();

	const listing = jsonLdBlocks(await (await request.get('/hendingar')).text());
	const list = listing.find((b) => b['@type'] === 'ItemList');
	expect(list, 'a listing must be described as a list').toBeTruthy();
	// Server-rendered, not fetched after hydration: this whole file reads raw HTML, so a block that
	// only appeared in the browser would fail here — which is the point.
	expect(Number(list!.numberOfItems)).toBeGreaterThan(0);
});

test('an event with a known venue publishes a real postal address', async ({ request }) => {
	/*
	 * `location.address` is REQUIRED for Google's Event rich result, and for a long time no event
	 * had one: `venues.address` was empty for every row in the database while three importers were
	 * being handed a street address in a payload we already fetched.
	 *
	 * The seed carries at least one venue with an address, so this asserts the whole chain —
	 * importer to column to JSON-LD — rather than any one link of it. `streetAddress` is what
	 * Google actually reads; a `Place` with only a name does not qualify.
	 */
	const listing = await (await request.get('/hendingar')).text();
	const paths = [
		...new Set([...listing.matchAll(/href="(\/hending\/\d+[^"]*)"/g)].map((m) => m[1]))
	];

	const addresses: Record<string, unknown>[] = [];
	for (const path of paths.slice(0, 12)) {
		const event = jsonLdBlocks(await (await request.get(path!)).text()).find(
			(b) => b['@type'] === 'Event'
		);
		const location = event?.location;
		if (location && typeof location === 'object' && 'address' in location) {
			const address = (location as { address?: unknown }).address;
			if (address && typeof address === 'object')
				addresses.push(address as Record<string, unknown>);
		}
	}

	/*
	 * A street, specifically.
	 *
	 * An earlier version of this assertion accepted any one of streetAddress, postalCode or
	 * addressLocality — and passed with the address emission deleted, because `addressLocality`
	 * comes from `municipality` and predates all of this. `streetAddress` is the field that was
	 * missing and the field Google reads, so it is the field asserted.
	 */
	expect(
		addresses.filter((address) => address.streetAddress).length,
		'at least one event should publish a streetAddress'
	).toBeGreaterThan(0);

	for (const address of addresses) {
		expect(address['@type']).toBe('PostalAddress');
		expect(address.addressCountry).toBe('NO');
		// Never an empty PostalAddress: that asserts we know the address and that it is nothing.
		expect(Boolean(address.streetAddress ?? address.postalCode ?? address.addressLocality)).toBe(
			true
		);
		if (address.postalCode) expect(String(address.postalCode)).toMatch(/^\d{4}$/);
	}
});
