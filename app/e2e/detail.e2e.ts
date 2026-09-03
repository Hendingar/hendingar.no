import { expect, test } from '@playwright/test';

/**
 * The event page. The id leads the URL and the slug is decoration, so a retitled event never 404s
 * and never needs a redirect — that is the whole reason there is no slug column.
 */

test('a tile links to the event, with a readable slug', async ({ page }) => {
	await page.goto('/hendingar');
	const link = page.locator('article.tile a').first();
	const title = (await link.innerText()).trim();
	await link.click();

	await expect(page).toHaveURL(/\/hending\/\d+-[a-z0-9-]+$/);
	// Case-insensitive: the tile title is uppercased by CSS, the detail heading is not.
	await expect(page.locator('h1.ev__h')).toHaveText(new RegExp(`^${title}$`, 'i'));
});

test('the event page is server-rendered, with structured data', async ({ request, baseURL }) => {
	const listing = await (await request.get('/hendingar')).text();
	const href = /href="(\/hending\/\d+[^"]*)"/.exec(listing)?.[1];
	expect(href, 'the listing should link to an event').toBeTruthy();

	const html = await (await request.get(new URL(href!, baseURL).href)).text();
	expect(html).toContain('<h1');
	// We are an index, not a destination: being legible to search engines and calendar tools is
	// the job, so the JSON-LD is not optional decoration.
	expect(html).toContain('application/ld+json');
	expect(html).toContain('"@type":"Event"');
	expect(html).toContain('rel="canonical"');
});

test('a stale slug still resolves, because the id is authoritative', async ({ request }) => {
	const listing = await (await request.get('/hendingar')).text();
	const id = /href="\/hending\/(\d+)/.exec(listing)?.[1];
	expect(id).toBeTruthy();

	const response = await request.get(`/hending/${id}-heilt-anna-tittel-enn-foer`);
	expect(response.status()).toBe(200);
});

test('an unknown or malformed id is a 404, not a crash', async ({ request }) => {
	for (const path of ['/hending/99999999', '/hending/abc', '/hending/0', '/hending/-1']) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(404);
	}
});

test('times are 24-hour regardless of the browser locale', async ({ page }) => {
	await page.goto('/hendingar');
	await page.locator('article.tile a').first().click();
	await page.locator('h1.ev__h').waitFor();
	// Formatting is pinned to nb-NO in core precisely so an English-locale browser cannot turn
	// 18:00 into 6:00 PM. The assertion is the absence of the meridiem.
	const when = await page.locator('.facts dd').first().innerText();
	expect(when).toMatch(/\d{2}:\d{2}/);
	expect(when).not.toMatch(/\bAM\b|\bPM\b/i);
});

test('no horizontal overflow on the event page at 320px', async ({ page, request }) => {
	await page.setViewportSize({ width: 320, height: 800 });

	/*
	 * Tested on the WORST event, not the first one.
	 *
	 * This spec passed for months while the page overflowed by 415px on real data: every seeded
	 * event was short and posterless, so nothing ever pushed the layout. The seed now carries a
	 * long title, a poster and an unbreakable URL, and this picks whichever event has the longest
	 * title so the fixture and the assertion cannot drift apart again.
	 */
	const listing = await (await request.get('/hendingar')).text();
	const candidates = [...listing.matchAll(/href="(\/hending\/[^"]+)"[^>]*>([^<]+)</g)].map((m) => ({
		href: m[1]!,
		length: m[2]!.trim().length
	}));
	expect(candidates.length).toBeGreaterThan(0);
	const worst = candidates.sort((a, b) => b.length - a.length)[0]!;

	await page.goto(worst.href);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow, `${worst.href} (${worst.length} chars) must not scroll sideways`).toBe(0);
});
