import { expect, test } from '@playwright/test';

/**
 * The event page. The id leads the URL and the slug is decoration, so a retitled event never 404s
 * and never needs a redirect — that is the whole reason there is no slug column.
 */

test('a tile links to the event, with a readable slug', async ({ page }) => {
	await page.goto('/hendingar');
	const link = page.locator('article.tile a').first();
	const title = (await link.innerText()).trim();
	await link.click();

	await expect(page).toHaveURL(/\/hending\/\d+-[a-z0-9-]+$/);
	// Case-insensitive: the tile title is uppercased by CSS, the detail heading is not.
	await expect(page.locator('h1.ev__h')).toHaveText(new RegExp(`^${title}$`, 'i'));
});

test('the event page is server-rendered, with structured data', async ({ request, baseURL }) => {
	const listing = await (await request.get('/hendingar')).text();
	const href = /href="(\/hending\/\d+[^"]*)"/.exec(listing)?.[1];
	expect(href, 'the listing should link to an event').toBeTruthy();

	const html = await (await request.get(new URL(href!, baseURL).href)).text();
	expect(html).toContain('<h1');
	// We are an index, not a destination: being legible to search engines and calendar tools is
	// the job, so the JSON-LD is not optional decoration.
	expect(html).toContain('application/ld+json');
	// Any subtype: the category decides between `Event`, `MusicEvent`, `Festival` and the rest.
	expect(html).toMatch(/"@type":"(\w*Event|Festival)"/);
	expect(html).toContain('rel="canonical"');
});

test('a stale slug still resolves, because the id is authoritative', async ({ request }) => {
	const listing = await (await request.get('/hendingar')).text();
	const id = /href="\/hending\/(\d+)/.exec(listing)?.[1];
	expect(id).toBeTruthy();

	const response = await request.get(`/hending/${id}-heilt-anna-tittel-enn-foer`);
	expect(response.status()).toBe(200);
});

test('an unknown or malformed id is a 404, not a crash', async ({ request }) => {
	for (const path of ['/hending/99999999', '/hending/abc', '/hending/0', '/hending/-1']) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(404);
	}
});

test('times are 24-hour regardless of the browser locale', async ({ page }) => {
	await page.goto('/hendingar');
	await page.locator('article.tile a').first().click();
	await page.locator('h1.ev__h').waitFor();
	// Formatting is pinned to nb-NO in core precisely so an English-locale browser cannot turn
	// 18:00 into 6:00 PM. The assertion is the absence of the meridiem.
	const when = await page.locator('.facts dd').first().innerText();
	expect(when).toMatch(/\d{2}:\d{2}/);
	expect(when).not.toMatch(/\bAM\b|\bPM\b/i);
});

test('no horizontal overflow on the event page at 320px', async ({ page, request }) => {
	await page.setViewportSize({ width: 320, height: 800 });

	/*
	 * Tested on the WORST event, not the first one.
	 *
	 * This spec passed for months while the page overflowed by 415px on real data: every seeded
	 * event was short and posterless, so nothing ever pushed the layout. The seed now carries a
	 * long title, a poster and an unbreakable URL, and this picks whichever event has the longest
	 * title so the fixture and the assertion cannot drift apart again.
	 */
	const listing = await (await request.get('/hendingar')).text();
	const candidates = [...listing.matchAll(/href="(\/hending\/[^"]+)"[^>]*>([^<]+)</g)].map((m) => ({
		href: m[1]!,
		length: m[2]!.trim().length
	}));
	expect(candidates.length).toBeGreaterThan(0);
	const worst = candidates.sort((a, b) => b.length - a.length)[0]!;

	await page.goto(worst.href);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow, `${worst.href} (${worst.length} chars) must not scroll sideways`).toBe(0);
});

/** A title as a literal pattern — titles carry `?`, `(` and `+`. */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/*
 * The page is a way onward, not a dead end: its category, its date and its source each lead to
 * more of the same, and the bottom of the page previews them.
 */
test('the category, the date and the source each lead somewhere', async ({ page }) => {
	await page.goto('/hendingar');
	await page.locator('article.tile a').first().click();
	await page.locator('h1.ev__h').waitFor();

	await expect(page.locator('a.ev__cat')).toHaveAttribute(
		'href',
		/^\/hendingar\?kategori=[a-z-]+$/
	);
	await expect(page.locator('a.ev__day')).toHaveAttribute(
		'href',
		/^\/kalender\/\d{4}-\d{2}-\d{2}$/
	);
	await expect(page.locator('a.sources__all').first()).toHaveAttribute(
		'href',
		/^\/hendingar\?kjelde=[a-z0-9-]+$/
	);

	// The date goes to the day the event is on, which lists it.
	const title = (await page.locator('h1.ev__h').innerText()).trim();
	await page.locator('a.ev__day').click();
	await expect(page).toHaveURL(/\/kalender\/\d{4}-\d{2}-\d{2}$/);
	await expect(
		page.locator('article.tile').filter({ hasText: new RegExp(literal(title), 'i') })
	).toHaveCount(1);
});

test('related events are server-rendered, and tapping one shows THAT event', async ({ page }) => {
	await page.goto('/hendingar');
	await page.locator('article.tile a').first().click();
	const first = (await page.locator('h1.ev__h').innerText()).trim();

	const related = page.locator('section.related article.tile a.tile__link');
	await expect(related.first()).toBeVisible();
	const next = (await related.first().innerText()).trim();
	expect(next.toLowerCase()).not.toBe(first.toLowerCase());

	/*
	 * The page reads its event once, with a top-level await, and SvelteKit keeps a page alive
	 * across a navigation within its own route — so before the page was keyed on its address,
	 * this changed the URL and left the first event on screen.
	 */
	await related.first().click();
	await expect(page).toHaveURL(/\/hending\/\d+-/);
	await expect(page.locator('h1.ev__h')).toHaveText(new RegExp(`^${literal(next)}$`, 'i'));
});

test('a submitted poster is shown whole on its page, not as the card crop', async ({ page }) => {
	/*
	 * A photographed poster is the event's details — the date, the venue, the line-up — and a
	 * card's 16:10 band of it cuts most of them away. That band was all we ever stored, so the
	 * page could only show it. The seed's approved photo submission carries both files.
	 */
	await page.goto('/hendingar?kjelde=innsendt');
	await page
		.getByRole('link', { name: /Bygdekino/i })
		.first()
		.click();
	await expect(page).toHaveURL(/\/hending\/\d+/);

	const poster = page.locator('img.ev__poster');
	await expect(poster).toHaveAttribute('src', '/seed-poster-heile.svg');
	// One file, not a ladder: a srcset here would let the browser pick the crop back up.
	await expect(poster).not.toHaveAttribute('srcset');

	// And drawn whole — portrait in, portrait out, nothing cut by the box it sits in.
	const fits = await poster.evaluate((img: HTMLImageElement) => {
		const style = getComputedStyle(img);
		return { fit: style.objectFit, ratio: img.naturalHeight / img.naturalWidth };
	});
	expect(fits.fit).toBe('contain');
	expect(fits.ratio).toBeGreaterThan(1);
});
