import { expect, test } from '@playwright/test';

/**
 * /poppis, and the view counter it is ordered by.
 *
 * The counting rule is the part worth guarding: one per browser, ever, decided in the browser
 * because the server deliberately keeps no record of who opened what. A regression there does not
 * throw — the number simply becomes a page-load counter and nobody notices.
 */

test('/poppis leads to an ordering rather than being a third listing', async ({ page }) => {
	await page.goto('/poppis');
	await expect(page).toHaveURL(/\/poppis\/hjarta$/);
	await expect(page.locator('.tab--on')).toHaveText(/Flest hjarte/);
});

test('both orderings are server-rendered, not fetched after load', async ({ page }) => {
	/*
	 * The listing has to be in the HTML. A remote query's `loading` is always true during SSR, so
	 * the failure mode this guards is a page that ships a placeholder and no events — invisible to
	 * a reader with JavaScript and total for a crawler.
	 */
	for (const path of ['/poppis/hjarta', '/poppis/vist']) {
		const response = await page.request.get(path);
		expect(response.ok(), path).toBe(true);
		const html = await response.text();
		expect(html, path).toContain('class="grid');
		expect(html, path).not.toContain('Lastar');
	}
});

test('the two orderings are different pages with their own URLs', async ({ page }) => {
	await page.goto('/poppis/hjarta');
	await page.getByRole('link', { name: 'Mest opna' }).click();
	await expect(page).toHaveURL(/\/poppis\/vist$/);
	await expect(page.locator('.tab--on')).toHaveText(/Mest opna/);
	/*
	 * Its own class, not `.list__note`.
	 *
	 * With nothing viewed yet the page renders a second note as well ("nobody has opened anything"),
	 * so a shared selector matched two elements and failed on strict mode — but only when this spec
	 * happened to run before the one that counts a view. An order-dependent test is worse than none
	 * (rule 6), so the element under test says what it is.
	 */
	await expect(page.locator('.list__what')).toContainText(/ikkje kven som opna kva/);
});

test('only the views ordering shows open counts on its cards', async ({ page }) => {
	// A count on the front page or on /hendingar would turn "what is on soonest" into a ranking.
	await page.goto('/poppis/hjarta');
	await expect(page.locator('.tile__views')).toHaveCount(0);
	await page.goto('/hendingar');
	await expect(page.locator('.tile__views')).toHaveCount(0);

	await page.goto('/poppis/vist');
	expect(await page.locator('.tile__views').count()).toBeGreaterThan(0);
});

test('opening an event counts once, and a reload does not count again', async ({ page }) => {
	await page.goto('/hendingar');
	const href = await page.locator('.tile a').first().getAttribute('href');
	expect(href).toBeTruthy();

	await page.goto(href!);
	// The figure rendered is the count BEFORE this visit, so a first-ever open shows nothing.
	const readCount = async () => {
		const el = page.locator('.ev__views');
		return (await el.count()) === 0 ? 0 : Number((await el.innerText()).replace(/\D/g, ''));
	};

	// Give the effect a moment to report, then reload: the number should have moved by exactly one.
	await page.waitForTimeout(1500);
	await page.reload();
	const afterFirst = await readCount();
	expect(afterFirst).toBeGreaterThan(0);

	/*
	 * The assertion this file exists for. A second, third and fourth load from the same browser
	 * must not move the number — the id is remembered in localStorage and never sent again.
	 */
	for (let i = 0; i < 3; i++) {
		await page.reload();
		await page.waitForTimeout(300);
	}
	await page.reload();
	expect(await readCount()).toBe(afterFirst);
});

test('a browser that has forgotten counts again, which is the accepted cost', async ({
	page,
	context
}) => {
	/*
	 * Written down as a test rather than left implicit: the dedupe lives in the reader's browser
	 * precisely so we do not keep a record of who opened what, and the price is that clearing site
	 * data lets the same person count twice. That is the trade, not a defect.
	 */
	await page.goto('/hendingar');
	const href = await page.locator('.tile a').first().getAttribute('href');
	await page.goto(href!);
	await page.waitForTimeout(1200);
	await page.reload();
	const before = Number((await page.locator('.ev__views').innerText()).replace(/\D/g, ''));

	await context.clearCookies();
	await page.evaluate(() => localStorage.clear());
	await page.reload();
	await page.waitForTimeout(1200);
	await page.reload();
	expect(Number((await page.locator('.ev__views').innerText()).replace(/\D/g, ''))).toBe(
		before + 1
	);
});
