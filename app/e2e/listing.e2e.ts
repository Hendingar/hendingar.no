import { expect, test } from '@playwright/test';

/**
 * /hendingar — the same day-grouped, thumbnailed grid as the front page, plus a category filter
 * that is a URL rather than component state.
 */

test('the full listing is day-grouped with thumbnails, server-rendered', async ({ request }) => {
	const html = await (await request.get('/hendingar')).text();
	// It used to be a plain bulleted list: the page you land on after "vis fleire" looked like a
	// different product from the one you clicked out of.
	expect(html).toMatch(/day__h/);
	expect(html.match(/<article/g)?.length).toBeGreaterThan(10);
	expect(html).toContain('<img');
});

test('a category filter narrows the list in the server-rendered HTML', async ({ request }) => {
	const all = await (await request.get('/hendingar')).text();
	const filtered = await (await request.get('/hendingar?kategori=teater')).text();

	const count = (html: string) => html.match(/<article/g)?.length ?? 0;
	expect(count(filtered)).toBeGreaterThan(0);
	expect(count(filtered)).toBeLessThan(count(all));
	// Filtering must work with no JavaScript at all, which component state would not.
	expect(filtered).toMatch(/aria-current="page"[^>]*>\s*Teater|Teater[^<]*<span[^>]*>\d+/);
});

test('an unknown category shows everything rather than erroring', async ({ request }) => {
	const response = await request.get('/hendingar?kategori=finnesikkje');
	expect(response.status()).toBe(200);
	const html = await response.text();
	// A hand-edited URL is better answered with the full list than with an error page.
	expect(html.match(/<article/g)?.length).toBeGreaterThan(10);
});

test('clicking a filter updates the URL, the heading and the list', async ({ page }) => {
	await page.goto('/hendingar');
	const before = await page.locator('article.tile').count();

	await page.getByRole('link', { name: /^Teater/ }).click();
	await page.waitForURL(/kategori=teater/);

	await expect(page.locator('h1')).toHaveText(/teater/i);
	const after = await page.locator('article.tile').count();
	expect(after).toBeGreaterThan(0);
	expect(after).toBeLessThan(before);

	// The active chip is marked structurally, not by colour alone.
	await expect(page.getByRole('link', { name: /^Teater/ })).toHaveAttribute('aria-current', 'page');
});

test('the filter only offers categories that have events', async ({ page }) => {
	await page.goto('/hendingar');
	const chips = page.locator('nav[aria-label="Filtrer på kategori"] a');
	const labels = await chips.allInnerTexts();
	expect(labels.length).toBeGreaterThan(1);
	// Every chip carries a count, and no count is zero — sixteen chips where eleven lead nowhere
	// is a worse control than five that all go somewhere.
	for (const label of labels.slice(1)) {
		const n = Number(label.trim().split(/\s+/).at(-1));
		expect(n).toBeGreaterThan(0);
	}
});

test('no horizontal overflow on the listing at 320px', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	for (const path of ['/hendingar', '/hendingar?kategori=musikk']) {
		await page.goto(path);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow, `${path} at 320px`).toBe(0);
	}
});
