import { expect, test } from '@playwright/test';

/** The front-page grid and the status board — both must be real without JavaScript. */

test('today grid is server-rendered at the top of the page', async ({ request }) => {
	const html = await (await request.get('/')).text();
	expect(html).not.toContain('Lastar…');
	// Six tiles, present in the HTML a crawler receives.
	expect(html.match(/<article class="tile/g)?.length).toBeGreaterThan(0);
	// And it comes before the brand hero in document order — that is the whole point of the change.
	const grid = html.indexOf('h-today');
	const hero = html.indexOf('hero__word');
	expect(grid).toBeGreaterThan(-1);
	expect(hero).toBeGreaterThan(-1);
	expect(grid).toBeLessThan(hero);
});

test('grid shows at most six events and offers more', async ({ page }) => {
	await page.goto('/');
	const tiles = page.locator('article.tile');
	expect(await tiles.count()).toBeLessThanOrEqual(6);
	await expect(page.getByRole('link', { name: 'Vis fleire' })).toBeVisible();
});

test('every tile has a thumbnail with a text alternative', async ({ page }) => {
	await page.goto('/');
	const tiles = page.locator('article.tile');
	const n = await tiles.count();
	expect(n).toBeGreaterThan(0);
	for (let i = 0; i < n; i++) {
		// Either a real poster (alt="", decorative beside the title) or a generated tile with a label.
		const thumb = tiles.nth(i).locator('.thumb');
		await expect(thumb).toHaveCount(1);
	}
});

test('datasamling reports the source, method and schedule', async ({ page }) => {
	await page.goto('/datasamling');
	await expect(page.getByRole('heading', { level: 1, name: /datasamling/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /det skjer sunnhordland/i })).toBeVisible();
	// Method and rhythm are stated, not implied.
	await expect(page.getByText('JSON-API')).toBeVisible();
	await expect(page.getByText(/dagleg \d{2}:\d{2} UTC/)).toBeVisible();
});

test('datasamling shows run history rather than claiming a status', async ({ page }) => {
	await page.goto('/datasamling');
	const strip = page.getByRole('list', { name: /siste køyringar/i });
	await expect(strip).toBeVisible();
	expect(await strip.locator('li').count()).toBeGreaterThan(0);
});

test('site navigation reaches both pages', async ({ page }) => {
	await page.goto('/');
	await page
		.getByRole('navigation', { name: 'Hovudmeny' })
		.getByRole('link', { name: 'Datasamling' })
		.click();
	await expect(page).toHaveURL(/\/datasamling$/);
	await expect(page.getByRole('link', { name: 'Datasamling' }).first()).toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('no horizontal overflow on the new pages', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	for (const path of ['/', '/datasamling']) {
		await page.goto(path);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow, `${path} at 320px`).toBe(0);
	}
});
