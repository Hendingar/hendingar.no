import { expect, test } from '@playwright/test';

/**
 * Search, and the one field that carries it.
 *
 * `/hendingar` used to hold forty chips — sixteen categories and twenty-three calendars — and no
 * way at all to look for a word. It now holds one field: you type, it offers places, kinds,
 * calendars and named events, and what you pick becomes a token you can take off again.
 *
 * The rule that outranks all of it is the one the chips were built to (#81): a filter has to be a
 * URL. So most of what is asserted here is asserted WITHOUT a browser, or with JavaScript switched
 * off — the suggestions are an enhancement, and everything under them has to work without.
 */

test('a search is a server-rendered page, not a client-side filter', async ({ request }) => {
	const all = await (await request.get('/hendingar')).text();
	const found = await (await request.get('/hendingar?q=konsert')).text();

	const count = (html: string) => html.match(/<article/g)?.length ?? 0;
	expect(count(found), 'the search found something').toBeGreaterThan(0);
	expect(count(found), 'and it is fewer than everything').toBeLessThan(count(all));
	// The word is in the heading, and the field is holding it, both in the HTML itself.
	expect(found).toMatch(/Søk: konsert/);
	expect(found).toMatch(/value="konsert"/);
});

test('the search reaches the venue, not just the title', async ({ request }) => {
	/*
	 * The reason this is a search over four fields rather than over titles.
	 *
	 * "Den Blå Time" is a venue in the seed and appears in one seeded title; the events at it that
	 * are NOT named after it are the ones a title-only search would miss, and they are what
	 * somebody typing a place name is looking for.
	 */
	const html = await (await request.get('/hendingar?q=blå')).text();
	expect(html.match(/<article/g)?.length ?? 0).toBeGreaterThan(0);
	expect(html).toContain('Den Blå Time');
});

test('every word has to match, so a two-word search narrows', async ({ request }) => {
	const one = await (await request.get('/hendingar?q=konsert')).text();
	const two = await (await request.get('/hendingar?q=konsert%20blå')).text();
	const count = (html: string) => html.match(/<article/g)?.length ?? 0;

	expect(count(two)).toBeGreaterThan(0);
	expect(count(two)).toBeLessThanOrEqual(count(one));
});

test('a wildcard is searched for, not obeyed', async ({ request }) => {
	/*
	 * `%` is a LIKE wildcard, so an unescaped one matches every row — which reads as "search is
	 * broken" rather than as "no results". `likePattern` escapes it; this is that escape, asserted
	 * where it actually matters. Nothing in the seed contains a percent sign.
	 */
	const all = await (await request.get('/hendingar')).text();
	const wild = await (await request.get('/hendingar?q=%25')).text();

	const count = (html: string) => html.match(/<article/g)?.length ?? 0;
	expect(count(all)).toBeGreaterThan(10);
	expect(count(wild), 'a percent sign must not match everything').toBe(0);
	expect(wild).toContain('Ingen treff');
});

test('a search that finds nothing says so, and offers the way back', async ({ request }) => {
	const html = await (await request.get('/hendingar?q=zzzznope')).text();
	expect(html).toMatch(/Ingen treff for «zzzznope»/);
	// Two ways out, both real links: widen the search, or send the missing event in yourself.
	expect(html).toMatch(/href="\/hendingar"/);
	expect(html).toMatch(/href="\/send-inn"/);
});

test('a searched listing asks not to be indexed', async ({ request }) => {
	/*
	 * `?q=` is unbounded — every query a crawler can invent is another URL — so it is the one
	 * listing view kept out of the index. The plain listing and the category views must stay in it,
	 * which is the half of this that would break silently.
	 */
	const searched = await (await request.get('/hendingar?q=konsert')).text();
	expect(searched).toMatch(/<meta name="robots" content="noindex, follow"/);

	for (const path of ['/hendingar', '/hendingar?kategori=musikk']) {
		const html = await (await request.get(path)).text();
		expect(html, `${path} must stay indexable`).not.toContain('noindex');
		expect(html, `${path} keeps its canonical`).toMatch(/rel="canonical"/);
	}
});

test('the field works with JavaScript switched off', async ({ browser }) => {
	/*
	 * The whole control is a GET form first and a combobox second. With scripting off there are no
	 * suggestions — they only exist in answer to typing — but the search itself, and the filters
	 * already applied, have to survive being submitted.
	 */
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto('/hendingar?kategori=musikk');

	await page.locator('#hendingar-sok').fill('konsert');
	await page.locator('.finder__go').click();
	await page.waitForLoadState('load');

	await expect(page).toHaveURL(/kategori=musikk/);
	await expect(page).toHaveURL(/q=konsert/);
	// The category it was filtered to came along, carried by the hidden fields.
	await expect(page.locator('.token')).toHaveText(/Musikk/);
	// And no listbox was rendered, because there is nothing to render it.
	expect(await page.locator('.sugg').count()).toBe(0);
	await context.close();
});

test('the field offers places, kinds and named events at once', async ({ page }) => {
	await page.goto('/hendingar');
	// Focus first: the open list proves the control is hydrated, so what follows tests the
	// suggestions rather than the race between typing and the bundle.
	await page.locator('#hendingar-sok').click();
	const rows = page.locator('.sugg__row');
	await expect(rows.first()).toBeVisible();
	await page.locator('#hendingar-sok').fill('bok');

	/*
	 * The free-text row is the one that is always there, and it carries the count — so pressing it
	 * is never a leap in the dark, including when the answer is zero.
	 */
	const free = rows.filter({ hasText: /^Søk/ });
	await expect(free).toHaveCount(1);
	await expect(free.locator('.sugg__hint')).toHaveText(/^\d+$/);

	// Every row is a real address, which is what makes Enter, a click and a middle-click agree.
	for (const row of await rows.all()) {
		await expect(row.locator('a')).toHaveAttribute('href', /^\/(hendingar|hending)/);
	}
});

test('the suggestion list is a keyboard control', async ({ page }) => {
	await page.goto('/hendingar');
	const field = page.locator('#hendingar-sok');
	/*
	 * Click and wait for the list before typing.
	 *
	 * The field is server-rendered and accepts text before the page has hydrated — that is the
	 * point of it — so a spec that types the instant `goto` resolves is racing the bundle, and a
	 * suggestion list that has no handlers yet is not a failure of the thing under test. The open
	 * list is proof that the control is live; everything after it is the actual assertion.
	 */
	await field.click();
	await expect(page.locator('.sugg__row').first()).toBeVisible();
	await field.fill('bok');
	await expect(page.locator('.sugg__row').first()).toBeVisible();

	// Announced as a combobox, and the active option is named for a screen reader rather than
	// signalled by the highlight alone.
	await expect(field).toHaveAttribute('aria-expanded', 'true');
	await field.press('ArrowDown');
	const active = page.locator('.sugg__row--active');
	await expect(active).toHaveCount(1);
	const id = await active.getAttribute('id');
	await expect(field).toHaveAttribute('aria-activedescendant', id!);

	await field.press('Enter');
	await page.waitForURL(/\/hendingar\?|\/hending\//);

	// Escape closes it without navigating anywhere.
	await page.goto('/hendingar');
	await field.click();
	await expect(page.locator('.sugg__row').first()).toBeVisible();
	await field.fill('bok');
	await expect(page.locator('.sugg__row').first()).toBeVisible();
	await field.press('Escape');
	await expect(page.locator('.sugg')).toHaveCount(0);
	await expect(page).toHaveURL(/\/hendingar$/);
});

test('a shared search URL comes back as the same page', async ({ page }) => {
	// The point of keeping every filter in the address: somebody can send this to a friend.
	await page.goto('/hendingar?q=konsert&kategori=musikk');
	await expect(page.locator('#hendingar-sok')).toHaveValue('konsert');
	await expect(page.locator('.token')).toHaveText(/Musikk/);
	await expect(page.locator('h1')).toHaveText(/Søk: konsert/);
});
