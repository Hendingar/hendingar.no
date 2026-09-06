import { expect, test } from '@playwright/test';

/**
 * Places that are open, kept out of the list of things that happen.
 *
 * The row this exists for is an escape room imported as ONE event running 2023-01-01 to 2027-12-31.
 * Every listing groups by `greatest(starts_at, now())`, so a five-year span was filed under "I dag"
 * every day, above the concerts. The classification itself is a generated column and is covered by
 * unit tests in packages/core; what is asserted here is the half those cannot reach — that the
 * listings actually exclude it, and that it is somewhere a reader can still find.
 */

test('a standing offer is never one of the event tiles', async ({ request }) => {
	/*
	 * The seed carries one: an escape room with a multi-year span. If it turns up as a tile, the
	 * filter has come off somewhere — and that failure is invisible by nature, because the page
	 * still looks fine, just with one more card on it every single day for years.
	 *
	 * Asserted against the TILES rather than the whole document, deliberately. `/denne-helga` and
	 * the day pages carry an "Òg ope denne dagen" line that names standing offers on purpose, so a
	 * document-wide match would fail on the very feature this change adds. What must never happen is
	 * one of them being rendered as an event.
	 */
	for (const path of ['/', '/hendingar', '/denne-helga', '/neste-helg', '/poppis/hjarta']) {
		const html = await (await request.get(path)).text();
		const tiles = html.match(/<article class="tile[\s\S]*?<\/article>/g) ?? [];
		for (const tile of tiles) {
			expect(tile, `${path} rendered a standing offer as an event tile`).not.toMatch(
				/Sunnhordland Escape/i
			);
		}
	}
});

test('the front page gathers them once, after the events', async ({ request }) => {
	const html = await (await request.get('/')).text();

	const band = html.search(/<section[^>]*class="standing/);
	expect(band, 'the standing band must be server-rendered').toBeGreaterThan(-1);

	/*
	 * After the event list AND after the coverage strip. The strip is the last word about the event
	 * list; a section above it would read as a caveat on the count.
	 */
	const grid = html.indexOf('h-up');
	const coverage = html.search(/<aside class="coverage/);
	expect(grid).toBeGreaterThan(-1);
	expect(coverage).toBeGreaterThan(-1);
	expect(grid).toBeLessThan(band);
	expect(coverage).toBeLessThan(band);

	// Once, not per day — the whole point of the placement.
	expect(html.match(/<section[^>]*class="standing/g) ?? []).toHaveLength(1);
});

test('/alltid-ope is real server-rendered HTML and holds the offer', async ({ request }) => {
	const response = await request.get('/alltid-ope');
	expect(response.status()).toBe(200);

	const html = await response.text();
	expect(html).toContain('<h1');
	expect(html).toMatch(/Alltid ope/);
	// A remote query's `loading` is always true during SSR, so a boundary here would ship a
	// placeholder and no content — the trap CLAUDE.md records. This page uses a top-level await.
	expect(html).not.toContain('Lastar');
	expect(html).toMatch(/Sunnhordland Escape/i);
});

test('a standing offer keeps its own page and its links still resolve', async ({ page }) => {
	/*
	 * `getEvent` deliberately does not filter on kind. Classifying a row must not 404 the URL it
	 * already had — somebody may have sent that link to somebody else.
	 */
	await page.goto('/alltid-ope');
	const link = page.locator('article.card h3 a').first();
	await expect(link).toBeVisible();
	await link.click();
	await expect(page).toHaveURL(/\/hending\/\d+-/);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('the standing card carries no clock, because it has none', async ({ page }) => {
	/*
	 * The reason this is not an EventTile. That card's vocabulary is time — a peach clock chip and
	 * an "om 3 t" badge — and putting a standing offer in one is how the escape room came to
	 * announce itself at 01:00 every morning. The category takes the clock's place.
	 */
	await page.goto('/alltid-ope');
	const card = page.locator('article.card').first();
	await expect(card).toBeVisible();
	expect(await card.locator('.time').count()).toBe(0);
	expect(await card.locator('.soon').count()).toBe(0);
	await expect(card.locator('.card__kind')).toBeVisible();
});

test('a day page points at them in one line rather than repeating the cards', async ({ page }) => {
	await page.goto('/denne-helga');
	const also = page.getByRole('complementary', { name: 'Alltid ope' });

	// Absent is acceptable only when there is genuinely nothing standing to point at.
	if ((await also.count()) === 0) {
		const offers = await (await page.request.get('/alltid-ope')).text();
		expect(offers).toMatch(/Vi har ikkje registrert nokon faste stader enno/);
		return;
	}

	await expect(also).toBeVisible();
	// A line, not a grid: no cards inside it, and a way through to the rest.
	expect(await also.locator('article').count()).toBe(0);
	await expect(also.getByRole('link', { name: /alltid ope|andre/i })).toBeVisible();
});

test('the coverage strip counts them separately from events', async ({ request }) => {
	/*
	 * "N hendingar framover" must not include a five-year span, or the site's headline number is
	 * quietly untrue. Nor should they be invisible — they are collected and they are ours.
	 */
	const html = await (await request.get('/')).text();
	const coverage = html.match(/<aside class="coverage[^"]*"[\s\S]*?<\/aside>/)?.[0];
	expect(coverage).toBeTruthy();
	expect(coverage).toMatch(/hendingar framover/i);
	expect(coverage).toMatch(/alltid (er )?open|alltid (er )?opne/i);
});
