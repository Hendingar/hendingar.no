import { expect, test } from '@playwright/test';

/**
 * The queue, and the loop it exists to close.
 *
 * A submission that does not pass used to vanish: the sender saw a verdict once and had no way
 * back to it. `/ko` is that way back — their own submissions, why each one did or did not go out,
 * and a link to revise it.
 *
 * Per-browser, so each test's context is its own account without anyone logging in.
 */

async function submit(
	page: import('@playwright/test').Page,
	title: string,
	extra?: () => Promise<void>
) {
	await page.goto('/send-inn');
	await page.locator('#title').fill(title);
	await page.locator('#category').selectOption('festival');
	await page.locator('#date').fill('2027-05-19');
	await page.locator('#startTime').fill('11:00');
	await page.locator('#venueName').fill('Vinsen59');
	await extra?.();
	await page.getByRole('button', { name: /Send inn hendinga/ }).click();
	await page.waitForSelector('.verdict', { timeout: 20_000 });
}

test('an empty queue says so rather than showing an empty list', async ({ page }) => {
	await page.goto('/ko');
	await expect(page.getByText(/ikkje sendt inn noko/i)).toBeVisible();
	await expect(page.locator('.card')).toHaveCount(0);
});

test('a submission that did not pass appears in the queue, with the reason', async ({ page }) => {
	// The menu item is absent until there is something in it — an always-present, always-empty
	// item is a standing promise of a feature nobody has used.
	await page.goto('/send-inn');
	await expect(page.locator('nav a[href="/ko"]')).toHaveCount(0);

	await submit(page, 'Fiskefestival i Vinsen');
	await expect(page.locator('.verdict__head')).toHaveAttribute('data-outcome', 'declined');

	await page.goto('/ko');
	const card = page.locator('.card').first();
	await expect(card).toBeVisible();
	await expect(card).toContainText('Fiskefestival i Vinsen');

	// The point of the page: not that it failed, but why, and what to do.
	await expect(card.locator('.reasons li')).not.toHaveCount(0);
	await expect(card.locator('.card__fix')).not.toHaveText('');
	await expect(page.locator('nav a[href="/ko"]')).toBeVisible();
});

test('the revise link opens the form as a revision of that submission', async ({ page }) => {
	await submit(page, 'Fiskefestival i Vinsen');
	await page.goto('/ko');

	const href = await page.locator('.card__actions a').first().getAttribute('href');
	expect(href).toMatch(/^\/send-inn\?rett=\d+$/);

	await page.goto(href!);
	const id = /rett=(\d+)/.exec(href!)![1];
	// The id travels in the form, so the server knows which row to replace rather than adding one.
	await expect(page.locator('input[name*=revisionOf]')).toHaveValue(id!);
});

test('a revision opens filled in, so nothing has to be retyped', async ({ page }) => {
	/*
	 * The bug this exists for. `?rett=` carried only the id: the server knew which row to replace
	 * and the fields knew nothing, so correcting one wrong date meant retyping the other ten. That
	 * is the kind of friction that makes people abandon the loop rather than use it.
	 */
	await submit(page, 'Fiskefestival i Vinsen');
	await page.goto('/ko');
	const href = await page.locator('.card__actions a').first().getAttribute('href');

	await page.goto(href!);
	await expect(page.locator('#title')).toHaveValue('Fiskefestival i Vinsen', { timeout: 10_000 });
	await expect(page.locator('#category')).toHaveValue('festival');
	await expect(page.locator('#venueName')).toHaveValue('Vinsen59');
	// The wall clock somebody typed, read back in the venue's zone rather than the server's — a
	// 20:00 concert returning as 18:00 would have them "correct" a time that was right.
	await expect(page.locator('#date')).toHaveValue('2027-05-19');
	await expect(page.locator('#startTime')).toHaveValue('11:00');
});

test('one browser cannot read back another’s draft', async ({ page, context }) => {
	await submit(page, 'Fiskefestival i Vinsen');
	await page.goto('/ko');
	const href = await page.locator('.card__actions a').first().getAttribute('href');

	// Same URL, different browser: the id is not a capability, the browser id is.
	const other = await context.browser()!.newContext();
	const stranger = await other.newPage();
	await stranger.goto(new URL(href!, page.url()).toString());
	await stranger.waitForTimeout(1500);
	await expect(stranger.locator('#title')).toHaveValue('');
	await other.close();
});

test('revising replaces the submission instead of stacking another draft', async ({ page }) => {
	/*
	 * The loop this closes. Without replacement each attempt leaves a near-identical row behind,
	 * and the second attempt is flagged as a duplicate of the first — so the queue fills up with
	 * drafts of one event that can never get out.
	 */
	await submit(page, 'Fiskefestival i Vinsen');
	await page.goto('/ko');
	await expect(page.locator('.card')).toHaveCount(1);

	const href = await page.locator('.card__actions a').first().getAttribute('href');
	await page.goto(href!);
	await page.locator('#title').fill('Fiskefestival i Vinsen');
	await page.locator('#category').selectOption('festival');
	await page.locator('#date').fill('2027-05-19');
	await page.locator('#startTime').fill('11:00');
	await page.locator('#venueName').fill('Vinsen59');
	await page.locator('#sourceUrl').fill('https://example.no/fiskefestival');
	await page.getByRole('button', { name: /Send inn hendinga/ }).click();
	await page.waitForSelector('.verdict', { timeout: 20_000 });

	await page.goto('/ko');
	await expect(page.locator('.card')).toHaveCount(1);
});

test('one browser never sees another browser’s submissions', async ({ page, context }) => {
	await submit(page, 'Fiskefestival i Vinsen');
	await page.goto('/ko');
	await expect(page.locator('.card')).toHaveCount(1);

	// No account, so the only thing scoping the queue is the browser's own opaque id.
	const other = await context.browser()!.newContext();
	const stranger = await other.newPage();
	await stranger.goto(new URL('/ko', page.url()).toString());
	await expect(stranger.getByText(/ikkje sendt inn noko/i)).toBeVisible();
	await expect(stranger.locator('.card')).toHaveCount(0);
	await other.close();
});

test('the queue is not offered to crawlers', async ({ request }) => {
	const html = await (await request.get('/ko')).text();
	expect(html).toMatch(/<meta name="robots" content="noindex"/);
});
