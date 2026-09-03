import { expect, test } from '@playwright/test';

/**
 * Endless listing.
 *
 * The page used to ask for 100 events and stop dead there, with no way to reach anything beyond.
 * It now renders a short first page server-side and fetches the next one before the reader arrives
 * at the bottom.
 */

async function tiles(page: import('@playwright/test').Page) {
	return page.locator('article.tile').count();
}

test('the first page is server-rendered, not fetched', async ({ request }) => {
	/*
	 * The whole point of paginating rather than lazy-loading everything: a crawler and a reader
	 * with no JavaScript still get a real listing in the HTML.
	 */
	const html = await (await request.get('/hendingar')).text();
	expect(html).toMatch(/class="tile__link/);
	expect(html.match(/class="tile__link/g)?.length ?? 0).toBeGreaterThan(3);
});

test('scrolling appends more events without repeating any', async ({ page }) => {
	await page.goto('/hendingar');
	const first = await tiles(page);
	expect(first).toBeGreaterThan(3);

	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await expect
		.poll(async () => tiles(page), { timeout: 10_000 })
		.toBeGreaterThan(first);

	/*
	 * No repeats.
	 *
	 * Offset paging re-reads a shifted window if an event is added or passes its start time between
	 * requests, and Svelte's keyed each throws outright on a duplicate key rather than rendering it
	 * twice — so this guards against a crash, not just untidiness.
	 */
	const hrefs = await page
		.locator('article.tile a.tile__link')
		.evaluateAll((links) => links.map((l) => l.getAttribute('href')));
	expect(new Set(hrefs).size).toBe(hrefs.length);
});

test('there is a real button, not only a scroll trigger', async ({ page }) => {
	// Someone on a keyboard, or a browser that never fires the observer, still needs a way down.
	await page.goto('/hendingar');
	const more = page.getByRole('button', { name: /vis fleire/i });
	if ((await more.count()) === 0) return; // the seed can be shorter than one page
	const before = await tiles(page);
	await more.click();
	await expect.poll(async () => tiles(page), { timeout: 10_000 }).toBeGreaterThan(before);
});

test('event tiles animate in, and stop when reduced motion is asked for', async ({ browser }) => {
	const lively = await browser.newContext({ reducedMotion: 'no-preference' });
	const livelyPage = await lively.newPage();
	await livelyPage.goto('/hendingar');
	const animated = await livelyPage
		.locator('article.tile')
		.first()
		.evaluate((el) => getComputedStyle(el.parentElement!).animationName);
	expect(animated, 'tiles should rise in').toBe('rise');
	await lively.close();

	/*
	 * The global reduced-motion reset collapses durations, which leaves an animation running for a
	 * hair — long enough to paint a translated frame. `.rise` is switched off by name instead, and
	 * this asserts that rather than trusting it.
	 */
	const calm = await browser.newContext({ reducedMotion: 'reduce' });
	const calmPage = await calm.newPage();
	await calmPage.goto('/hendingar');
	const still = await calmPage
		.locator('article.tile')
		.first()
		.evaluate((el) => getComputedStyle(el.parentElement!).animationName);
	expect(still, 'no entrance animation under reduced motion').toBe('none');
	await calm.close();
});
