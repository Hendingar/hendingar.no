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

test('no horizontal overflow on the event page at 320px', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto('/hendingar');
	const href = await page.locator('article.tile a').first().getAttribute('href');
	await page.goto(href!);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBe(0);
});
