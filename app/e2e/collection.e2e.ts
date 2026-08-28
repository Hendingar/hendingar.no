import { expect, test } from '@playwright/test';

/** The front-page grid and the status board — both must be real without JavaScript. */

test('the listing is server-rendered above the brand hero', async ({ request }) => {
	const html = await (await request.get('/')).text();
	expect(html).not.toContain('Lastar…');
	expect(html.match(/<article class="tile/g)?.length).toBeGreaterThan(0);
	// It comes before the hero in document order — that is the whole point of the change.
	const grid = html.indexOf('h-up');
	const hero = html.indexOf('hero__word');
	expect(grid).toBeGreaterThan(-1);
	expect(hero).toBeGreaterThan(-1);
	expect(grid).toBeLessThan(hero);
});

test('events are grouped under day headings, today first', async ({ page }) => {
	await page.goto('/');
	const headings = await page.locator('.day__h').allInnerTexts();
	expect(headings.length).toBeGreaterThan(1);
	// The first group is today (or tomorrow, on a day with nothing on).
	expect(headings[0]).toMatch(/I dag|I morgon/i);
	// Each group is its own labelled region, so the date is structural, not just visual.
	for (const h of await page.locator('section.day').all()) {
		await expect(h).toHaveAttribute('aria-labelledby', /^day-\d{4}-\d{2}-\d{2}$/);
	}
});

test('a still-running multi-day event is grouped under today, not its start date', async ({
	page
}) => {
	await page.goto('/');
	const first = page.locator('section.day').first();
	await expect(first.locator('.day__h')).toContainText(/I dag/i);
	// The seeded exhibition opened days ago and runs for another week.
	await expect(first).toContainText(/Utstilling: Havet og oss/i);
});

test('every tile has a thumbnail and offers more', async ({ page }) => {
	await page.goto('/');
	const tiles = page.locator('article.tile');
	const n = await tiles.count();
	expect(n).toBeGreaterThan(0);
	for (let i = 0; i < n; i++) {
		await expect(tiles.nth(i).locator('.thumb')).toHaveCount(1);
	}
	await expect(page.getByRole('link', { name: 'Vis fleire' })).toBeVisible();
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
	for (const path of ['/', '/datasamling', '/hendingar', '/send-inn']) {
		await page.goto(path);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow, `${path} at 320px`).toBe(0);
	}
});
