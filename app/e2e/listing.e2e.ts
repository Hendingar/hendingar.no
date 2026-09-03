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

test('a phone shows several events at once, not one card per screenful', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/hendingar');

	const tile = page.locator('article.tile').first();
	const box = (await tile.boundingBox())!;
	// The poster-on-top card was 315px tall here, so 2.7 events fitted on screen and finding next
	// Friday meant scrolling past pictures. As a row it is under half that. Asserting a budget
	// rather than an exact number: the point is density, not a specific design.
	expect(box.height, 'an event row must fit several to a screen').toBeLessThan(200);

	// Text left, thumbnail right — a row, not a stack. If the thumbnail is above the title the
	// layout has fallen back to the card and the height assertion above is the only thing left
	// holding it, which it would not for long.
	const thumb = (await tile.locator('.thumb').boundingBox())!;
	const title = (await tile.locator('.tile__t').boundingBox())!;
	expect(thumb.x, 'the thumbnail sits beside the text').toBeGreaterThan(title.x);
	expect(Math.abs(thumb.y - title.y), 'the thumbnail is not stacked above the title').toBeLessThan(
		box.height
	);
});

test('the category filters do not eat the screen on a phone', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/hendingar');

	const filters = page.getByRole('navigation', { name: 'Filtrer på kategori' });
	const box = (await filters.boundingBox())!;
	// Wrapped, sixteen chips were 271px — a third of the viewport spent on a control before a
	// single event was visible. One scrollable row is about 40px.
	expect(box.height, 'filters must not wrap into a block').toBeLessThan(80);

	// It scrolls sideways rather than shrinking the chips into unreadable slivers...
	const scrollable = await filters.evaluate(
		(el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === 'auto'
	);
	expect(scrollable, 'the chip row scrolls instead of wrapping').toBe(true);
	// ...and the page itself still does not scroll sideways, which is the trap here.
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow, 'a sideways-scrolling child must not drag the page with it').toBe(0);
});

test('the day heading stays visible while its events scroll past', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/hendingar');
	await page.evaluate(() => window.scrollTo(0, 900));
	await page.waitForTimeout(250);

	// Density created this problem: at five or six events a screen, a day runs well past the
	// heading that names it, and the list stops answering "which day is this".
	const pinned = await page.evaluate(() => {
		const hs = [...document.querySelectorAll('.day__h')];
		return hs.filter((h) => {
			const r = h.getBoundingClientRect();
			return r.top >= -1 && r.top < 60;
		}).length;
	});
	expect(pinned, 'exactly one day heading is pinned at the top').toBe(1);
});

test('an event reported by two sources is listed once', async ({ request }) => {
	const html = await (await request.get('/hendingar')).text();
	/*
	 * The seed carries the same show from two sources, spelled differently — one with an age limit.
	 *
	 * Counted on the title LINK, not on the title text: a generated thumbnail also carries the
	 * title in its `aria-label`, so a plain text match finds every tile twice and would have failed
	 * whatever the consolidation did.
	 */
	const listings = html.match(/class="tile__link[^"]*"[^>]*>Bård Tufte Johansen/g) ?? [];
	expect(listings.length, 'the same event must not appear twice').toBe(1);
});

test('the event page credits every source that reported it', async ({ page, request }) => {
	// Navigate by the href the listing actually rendered rather than by clicking and waiting on a
	// URL pattern: `/hendingar` and `/hending/` are one character apart, and a wait that matches
	// the page you are already on passes without going anywhere.
	const html = await (await request.get('/hendingar')).text();
	const href = /href="(\/hending\/[^"]+)"[^>]*>Bård Tufte Johansen/.exec(html)?.[1];
	expect(href, 'the consolidated event should be listed').toBeTruthy();
	await page.goto(href!);

	/*
	 * The canonical row is chosen by lowest id — an arbitrary tiebreak — so naming only its source
	 * would credit whichever importer happened to run first and drop the other.
	 *
	 * Scoped to the list itself. "Kjelder" is also the main navigation label, so asserting on that
	 * text alone passes on every page on the site.
	 */
	const sources = page.locator('ul.sources');
	await expect(sources).toBeVisible();
	expect(await sources.locator('li').count(), 'both sources must be credited').toBe(2);
	// Each links out, because crediting a source without pointing at it is not credit.
	expect(await sources.locator('li a').count()).toBe(2);
});

test('repeats of the same event on one day share a card', async ({ page }) => {
	await page.goto('/hendingar');

	/*
	 * Public swimming runs four times in the seed. Four identical posters down the page spend a
	 * screenful saying one thing, so they share a card and list their times.
	 *
	 * Consolidation must NOT have merged them — they are four real sessions — so this is a
	 * presentation grouping, and each time stays reachable.
	 */
	const cards = page.locator('article.tile').filter({ hasText: 'Offentleg symjing' });
	expect(await cards.count(), 'the repeats must share one card').toBe(1);

	const times = cards.first().locator('.times__t');
	expect(await times.count(), 'every session must still be listed').toBe(4);

	// Each chip is its own event page, not four links to the same row.
	const hrefs = await times.evaluateAll((els) => els.map((e) => e.getAttribute('href')));
	expect(new Set(hrefs).size, 'each time links to its own event').toBe(4);

	// And the card says how many, so the count is not something you have to infer by counting.
	await expect(cards.first().locator('.tile__count')).toContainText('4');
});

test('a repeated time is still reachable as its own event', async ({ page }) => {
	await page.goto('/hendingar');
	const card = page.locator('article.tile').filter({ hasText: 'Offentleg symjing' }).first();
	const second = card.locator('.times__t').nth(1);
	const href = await second.getAttribute('href');
	await second.click();
	await page.waitForURL(new RegExp(href!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	// The stretched card overlay must not swallow the chip's click and open the first session.
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Offentleg symjing');
});
