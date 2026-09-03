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

	const filters = page.getByRole('navigation', { name: 'Filtrer på kategori' });
	await filters.getByRole('link', { name: /^Teater/ }).click();
	await page.waitForURL(/kategori=teater/);

	await expect(page.locator('h1')).toHaveText(/teater/i);
	const after = await page.locator('article.tile').count();
	expect(after).toBeGreaterThan(0);
	expect(after).toBeLessThan(before);

	// The active chip is marked structurally, not by colour alone.
	await expect(filters.getByRole('link', { name: /^Teater/ })).toHaveAttribute(
		'aria-current',
		'page'
	);
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

test('a source filter narrows the list in the server-rendered HTML', async ({ request }) => {
	const all = await (await request.get('/hendingar')).text();
	const filtered = await (await request.get('/hendingar?kjelde=bomlobibliotek')).text();

	const count = (html: string) => html.match(/<article/g)?.length ?? 0;
	expect(count(filtered)).toBeGreaterThan(0);
	expect(count(filtered)).toBeLessThan(count(all));
	// Server-rendered, like the category filter — it has to work with no JavaScript at all.
	expect(filtered).toMatch(/aria-current="page"/);
});

test('an unknown source shows everything rather than erroring', async ({ request }) => {
	const response = await request.get('/hendingar?kjelde=finnesikkje');
	expect(response.status()).toBe(200);
	const html = await response.text();
	// Same treatment a hand-edited ?kategori= gets: sources are rows, not a compile-time set, so a
	// slug nobody publishes under must fall back to the full list.
	expect(html.match(/<article/g)?.length ?? 0).toBeGreaterThan(10);
});

test('the two filters compose instead of replacing each other', async ({ page }) => {
	await page.goto('/hendingar?kategori=musikk');

	const sources = page.getByRole('navigation', { name: 'Filtrer på kjelde' });
	await expect(sources).toBeVisible();
	// Pressing a source must keep the category. Dropping it would change the list in two ways at
	// once, and neither chip would explain why.
	const firstSource = sources.getByRole('link').nth(1);
	const href = await firstSource.getAttribute('href');
	expect(href, 'a source chip must carry the active category forward').toContain('kategori=musikk');
	expect(href).toContain('kjelde=');

	await firstSource.click();
	await page.waitForURL(/kategori=musikk/);
	await expect(page).toHaveURL(/kjelde=/);
	// Both chips read as active, so the page says what it is showing.
	await expect(
		page.getByRole('navigation', { name: 'Filtrer på kategori' }).locator('[aria-current="page"]')
	).toHaveText(/musikk/i);
	await expect(sources.locator('[aria-current="page"]')).toHaveCount(1);
});

test('the source filter names which calendar the list is from', async ({ page }) => {
	await page.goto('/hendingar?kjelde=bomlobibliotek');
	// "Alle hendingar" while showing one library's events would describe the page inaccurately.
	await expect(page.getByText(/frå\s+Bømlo folkebibliotek/i)).toBeVisible();
});
