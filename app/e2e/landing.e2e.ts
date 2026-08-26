import { expect, test } from '@playwright/test';

/**
 * These assert the things that were silently broken and that neither typecheck nor lint can see.
 */

test('events are in the server-rendered HTML, not fetched by the client', async ({ request }) => {
	// Requested without a browser, so nothing executes JS — this is what a crawler and a no-JS
	// visitor receive. Previously it contained the string "Lastar…" and zero events.
	const res = await request.get('/');
	expect(res.ok()).toBeTruthy();
	const html = await res.text();
	expect(html).not.toContain('Lastar…');
	expect(html).toMatch(/<article class="card/);
});

test('the page has one h1, named for the product', async ({ page }) => {
	await page.goto('/');
	// Accessible name, not text content: two block-level spans stack the word visually and used to
	// make this announce as "HEND INGAR".
	await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(/hendingar/i);
});

test('main landmark and a working skip link', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('main#innhald')).toHaveCount(1);
	await page.keyboard.press('Tab');
	await expect(page.getByRole('link', { name: 'Gå til innhaldet' })).toBeFocused();
});

test('no horizontal overflow at 320px', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	for (const path of ['/', '/hendingar']) {
		await page.goto(path);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow, `${path} must not scroll sideways at 320px`).toBe(0);
	}
});

test('event titles are headings so a long list is navigable', async ({ page }) => {
	await page.goto('/hendingar');
	await expect(page.getByRole('heading', { level: 1, name: /alle hendingar/i })).toBeVisible();
	// At least one event heading — they were <strong> before, invisible to heading navigation.
	expect(await page.getByRole('heading', { level: 2 }).count()).toBeGreaterThan(0);
});

test('health endpoint reports the database', async ({ request }) => {
	const res = await request.get('/health');
	expect(res.status()).toBe(200);
	expect(await res.json()).toMatchObject({ status: 'ok', database: 'ok' });
});
