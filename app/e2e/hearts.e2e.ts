import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Hearting, end to end.
 *
 * Worth testing here rather than in a unit test: the feature is a conversation between
 * localStorage, an optimistic UI and a server count, and every bug it can have lives in the seams
 * between those.
 *
 * Two rules make these hermetic (CLAUDE.md rule 6). The heart COUNT is shared state — one database,
 * tests running in parallel — so every test works on its own event and asserts a *change* rather
 * than an absolute number. Whether this browser has hearted something is per-context and needs no
 * such care.
 */

/** A tile nobody else in this file touches. */
const tile = (page: Page, n: number) => page.locator('article.tile').nth(n);

async function countOf(t: Locator): Promise<number> {
	const n = t.locator('.heart__n');
	return (await n.count()) === 0 ? 0 : Number(((await n.textContent()) ?? '0').trim());
}

test('hearting persists across a reload and reveals the Hjarta menu item', async ({ page }) => {
	await page.goto('/hendingar');

	// Absent until something is hearted: a permanent empty item would advertise a feature the
	// reader has not used, on every page, forever.
	await expect(page.locator('nav a[href="/hjarta"]')).toHaveCount(0);

	const target = tile(page, 0);
	/*
	 * `textContent`, not `innerText`. The tile heading is uppercased in CSS, so `innerText` returns
	 * "UTSTILLING: HAVET OG OSS" and would never match the DOM text this is compared against.
	 */
	const title = ((await target.getByRole('heading').first().textContent()) ?? '').trim();
	const before = await countOf(target);
	const heart = target.locator('button.heart');
	await expect(heart).toHaveAttribute('aria-pressed', 'false');

	await heart.click();
	await expect(heart).toHaveAttribute('aria-pressed', 'true');
	await expect(target.locator('.heart__n')).toHaveText(String(before + 1));

	const menu = page.locator('nav a[href="/hjarta"]');
	await expect(menu).toBeVisible();
	await expect(menu).toContainText('Hjarta');

	// Survives a reload, which is the whole point of localStorage here.
	await page.reload();
	await expect(tile(page, 0).locator('button.heart')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('nav a[href="/hjarta"]')).toBeVisible();

	await page.goto('/hjarta');
	await expect(page.getByRole('heading', { level: 1, name: /hjarta/i })).toBeVisible();
	await expect(page.locator('article.tile')).toHaveCount(1);
	await expect(page.locator('article.tile').first()).toContainText(title);
});

test('hearting does not open the event', async ({ page }) => {
	await page.goto('/hendingar');
	// The tile is one big stretched link, so the heart has to claim its own click.
	await tile(page, 1).locator('button.heart').click();
	await expect(page).toHaveURL(/\/hendingar$/);
});

test('un-hearting removes it everywhere, including the menu', async ({ page }) => {
	await page.goto('/hendingar');
	const target = tile(page, 2);
	const before = await countOf(target);
	const heart = target.locator('button.heart');

	await heart.click();
	await expect(heart).toHaveAttribute('aria-pressed', 'true');
	await expect(target.locator('.heart__n')).toHaveText(String(before + 1));
	await expect(page.locator('nav a[href="/hjarta"]')).toBeVisible();

	await heart.click();
	await expect(heart).toHaveAttribute('aria-pressed', 'false');
	// The count goes back down rather than leaving a phantom behind.
	expect(await countOf(tile(page, 2))).toBe(before);
	await expect(page.locator('nav a[href="/hjarta"]')).toHaveCount(0);

	await page.goto('/hjarta');
	await expect(page.getByText(/ikkje hjarta noko enno/i)).toBeVisible();
});

test('the count is public; the list of what you hearted is not', async ({ page, context }) => {
	await page.goto('/hendingar');
	const target = tile(page, 3);
	const before = await countOf(target);
	await target.locator('button.heart').click();
	await expect(target.locator('.heart__n')).toHaveText(String(before + 1));

	/*
	 * A second browser sees the count and none of the hearts.
	 *
	 * This is the whole privacy shape of the feature in one assertion: how many people hearted
	 * something is public, which events YOU hearted never leaves your browser.
	 */
	const other = await context.browser()!.newContext();
	const stranger = await other.newPage();
	await stranger.goto(new URL('/hendingar', page.url()).toString());
	const strangerTile = tile(stranger, 3);
	expect(await countOf(strangerTile)).toBeGreaterThanOrEqual(before + 1);
	await expect(strangerTile.locator('button.heart')).toHaveAttribute('aria-pressed', 'false');
	await expect(stranger.locator('nav a[href="/hjarta"]')).toHaveCount(0);
	await other.close();
});

test('hearting and un-hearting quickly leaves it un-hearted', async ({ page }) => {
	/*
	 * The regression this exists for.
	 *
	 * The button used to drop a tap that arrived while a request was in flight, and to undo the
	 * local change if that request failed. Together those left the event hearted after a fast
	 * heart-then-unheart — a race that only showed up on a slow enough round trip, which is why it
	 * passed locally and failed in CI.
	 */
	/*
	 * Latency, injected.
	 *
	 * Without it this passes against the broken version too: locally the round trip is fast enough
	 * that the second tap always lands after the first has settled. CI was slow enough to catch it,
	 * which is a terrible way to find out. Delaying the write makes the race deterministic here.
	 */
	await page.route('**/*', async (route) => {
		if (route.request().method() === 'POST') {
			await new Promise((r) => setTimeout(r, 400));
		}
		await route.continue();
	});

	await page.goto('/hendingar');
	const heart = tile(page, 4).locator('button.heart');

	for (let i = 0; i < 4; i += 1) {
		await heart.click();
		await heart.click();
	}

	await expect(heart).toHaveAttribute('aria-pressed', 'false');
	await page.goto('/hjarta');
	await expect(page.getByText(/ikkje hjarta noko enno/i)).toBeVisible();
});

test('an empty Hjarta page says so rather than showing an empty grid', async ({ page }) => {
	await page.goto('/hjarta');
	await expect(page.getByText(/ikkje hjarta noko enno/i)).toBeVisible();
	await expect(page.locator('article.tile')).toHaveCount(0);
});

test('the Hjarta page is not offered to crawlers', async ({ request }) => {
	// Per-visitor content with nothing to index, and nothing we would want indexed.
	const html = await (await request.get('/hjarta')).text();
	expect(html).toMatch(/<meta name="robots" content="noindex"/);
});
