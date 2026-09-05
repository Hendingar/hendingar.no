import { expect, test } from '@playwright/test';

/**
 * /kalender — a month of squares, each carrying how many events fall on that day, and a day page
 * behind every square that has something.
 *
 * Nothing here asserts a hardcoded date. The seed builds its events relative to now, so a spec
 * pinned to "12 September" would pass on the day it was written and fail every day after; these
 * read the month the page itself renders and follow its own links.
 */

test('the month grid is a real table of dates, server-rendered', async ({ request }) => {
	const html = await (await request.get('/kalender')).text();

	// Server-rendered, not a "Lastar…" placeholder: a calendar that only exists after hydration
	// indexes nothing, on a site whose whole job is being findable.
	expect(html).toContain('<table');
	expect(html).toContain('ei rad per veke');
	// Seven columns, named. The visible header is two letters, the accessible one is the weekday.
	expect(html).toContain('måndag');
	expect(html).toContain('sundag');
	// At least one day leads somewhere.
	expect(html).toMatch(/href="\/kalender\/\d{4}-\d{2}-\d{2}"/);
	// Today is marked structurally, not by colour alone.
	expect(html).toContain('aria-current="date"');
});

test('a day count leads to a page listing exactly that many events', async ({ page }) => {
	await page.goto('/kalender');

	/*
	 * The single assertion this feature is worth having.
	 *
	 * The badge and the page behind it are produced by one function bucketing instants into days
	 * at the venue's own clock (app/src/lib/calendar.ts). If those two ever disagree — the classic
	 * cause being a day derived in UTC for one and in the venue's zone for the other — a 00:30
	 * concert lands on the wrong side and this fails.
	 */
	const day = page.locator('a.cal__day').first();
	const label = await day.getAttribute('aria-label');
	expect(label).toMatch(/\d+ hending(ar)?/);
	const expected = Number(/(\d+) hending/.exec(label ?? '')?.[1]);
	expect(expected).toBeGreaterThan(0);

	await day.click();
	await page.waitForURL(/\/kalender\/\d{4}-\d{2}-\d{2}$/);

	// Anchored: an unanchored /1 hendingar/ would happily match "21 hendingar".
	await expect(page.locator('.day-page__count')).toHaveText(
		expected === 1 ? /^Éi hending$/ : new RegExp(`^${expected} hendingar$`)
	);
});

test('an empty but real date is a page, and nonsense is a 404', async ({ request }) => {
	// A date far past anything we hold. Real, so it gets a page — somebody can link to it, and
	// "nothing that day" is a true answer.
	const empty = await request.get('/kalender/2035-01-15');
	expect(empty.status()).toBe(200);
	expect(await empty.text()).toContain('Ingen hendingar denne dagen');

	// Shaped like a date and not one. 31 February has never happened.
	expect((await request.get('/kalender/2035-02-31')).status()).toBe(404);
	expect((await request.get('/kalender/i-morgon')).status()).toBe(404);
});

test('a hand-edited month falls back rather than erroring', async ({ request }) => {
	const current = await (await request.get('/kalender')).text();
	const heading = /class="[^"]*steps__now[^"]*"[^>]*>([^<]+)</.exec(current)?.[1]?.trim();
	expect(heading).toMatch(/^[A-ZÅÆØ]\p{L}+ \d{4}$/u);

	for (const bad of ['tull', '2026-13', '2019-01']) {
		const response = await request.get(`/kalender?maanad=${bad}`);
		expect(response.status()).toBe(200);
		const shown = /class="[^"]*steps__now[^"]*"[^>]*>([^<]+)</.exec(await response.text())?.[1];
		// Clamped into the range the data actually covers — never an empty grid from 2019.
		expect(shown?.trim()).not.toContain('2019');
		expect(shown?.trim()).toBeTruthy();
	}
});

test('Kalender is in the menu and stays marked on a day page', async ({ page }) => {
	await page.goto('/');
	const menu = page.getByRole('navigation', { name: 'Hovudmeny' });
	await menu.getByRole('link', { name: 'Kalender' }).click();
	await page.waitForURL(/\/kalender$/);
	await expect(menu.getByRole('link', { name: 'Kalender' })).toHaveAttribute(
		'aria-current',
		'page'
	);

	// A day is still the calendar. An exact pathname match would drop the marker here.
	await page.locator('a.cal__day').first().click();
	await page.waitForURL(/\/kalender\/\d{4}-\d{2}-\d{2}$/);
	await expect(menu.getByRole('link', { name: 'Kalender' })).toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('the grid is keyboard-reachable and the days are real links', async ({ page }) => {
	await page.goto('/kalender');
	// Days are anchors in reading order rather than a roving-tabindex grid, so tab reaches them.
	const first = page.locator('a.cal__day').first();
	await first.focus();
	await expect(first).toBeFocused();
	await expect(first).toHaveAttribute('href', /^\/kalender\/\d{4}-\d{2}-\d{2}$/);
});

test('no horizontal overflow at 320px', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto('/kalender');
	const day = await page.locator('a.cal__day').first().getAttribute('href');

	for (const path of ['/kalender', day ?? '/kalender/2035-01-15']) {
		await page.goto(path);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow, `${path} must not scroll sideways at 320px`).toBe(0);
	}
});

/*
 * The rail and the week view.
 *
 * Both read whatever the seed built rather than asserting a fixture: the seed places its events
 * relative to now, so anything pinned to a date passes on the day it is written and fails after.
 */

test('the horizon rail is server-rendered and every bar is a way into a week', async ({
	request,
	page
}) => {
	const html = await (await request.get('/kalender')).text();

	// In the HTML, not after hydration. The rail is the page's primary navigation and a crawler
	// that sees "Lastar…" finds no weeks at all.
	expect(html).toContain('rail__bar');
	expect(html).toMatch(/href="\/kalender\?veke=\d{4}-W\d{2}"/);

	await page.goto('/kalender');
	const bars = page.locator('a.rail__bar');
	// One bar per week of the materialisation horizon (ADR 0009). Not "some bars".
	await expect(bars).toHaveCount(26);

	// Every bar names itself in full: a row of 26 unlabelled rectangles is unusable by anyone not
	// looking at it, and the height is the only other thing carrying the figure.
	const label = await bars.first().getAttribute('aria-label');
	expect(label).toMatch(/Veke \d+, .+ — \d+ hending(ar)?/);
	// The first bar is this week, and says so.
	expect(label).toContain('denne veka');

	await bars.first().click();
	await page.waitForURL(/\/kalender\?veke=\d{4}-W\d{2}$/);
	await expect(page.locator('.views a[aria-current="page"]')).toHaveText('Veke');
});

test('the week view draws a time grid, server-rendered, and marks today', async ({
	request,
	page
}) => {
	await page.goto('/kalender');
	const week = await page.locator('a.rail__bar').first().getAttribute('href');
	expect(week).toBeTruthy();

	const html = await (await request.get(week!)).text();
	expect(html).toContain('week__frame');
	// Seven named columns, and the hour gutter that makes them a grid rather than seven lists.
	expect(html).toContain('måndag');
	expect(html).toContain('sundag');
	expect(html).toMatch(/class="[^"]*week__hour[^"]*"/);
	// Today is structural, not a colour.
	expect(html).toContain('aria-current="date"');
});

/**
 * The assertion the week view is worth having, and the same invariant the day badge already
 * carries: the number on a day header and the events behind it are one set.
 *
 * Both come from `localDayKey` bucketing instants at the venue's own clock. If the week view ever
 * derives its day differently — in UTC, or in the container's zone — a 00:30 concert lands in the
 * wrong column and this fails.
 */
test('a day header in the week view agrees with that day’s page', async ({ page }) => {
	await page.goto('/kalender');
	const week = await page.locator('a.rail__bar').first().getAttribute('href');
	await page.goto(week!);

	const header = page.locator('a.week__headlink').first();
	const count = Number(await header.locator('.week__n').innerText());
	expect(count).toBeGreaterThan(0);

	await header.click();
	await page.waitForURL(/\/kalender\/\d{4}-\d{2}-\d{2}$/);
	await expect(page.locator('.day-page__count')).toHaveText(
		count === 1 ? /^Éi hending$/ : new RegExp(`^${count} hendingar$`)
	);
});

test('an invented week falls back to the month rather than erroring', async ({ request }) => {
	// 2025 has 52 ISO weeks. `2025-W53` matches every week regex ever written and is not a week —
	// the same trap `2026-02-31` sets for dates.
	for (const bad of ['2025-W53', '2026-W54', 'veke-37', '2026-37']) {
		const response = await request.get(`/kalender?veke=${bad}`);
		expect(response.status()).toBe(200);
		const html = await response.text();
		// Fell back to the month view, which is the calendar rather than an error page.
		expect(html).toContain('ei rad per veke');
	}
});

test('a day square says how busy it is in more than one way', async ({ page }) => {
	await page.goto('/kalender');

	// The fill step is an attribute, so it is inspectable and cannot drift from the count silently.
	const busy = page.locator('td[data-density]:not([data-density="0"])').first();
	await expect(busy).toHaveCount(1);

	// Colour is never the only signal: the count is in the cell and the figure is in the link name.
	const link = busy.locator('a.cal__day');
	await expect(link.locator('.cal__count')).not.toBeEmpty();
	expect(await link.getAttribute('aria-label')).toMatch(/\d+ hending(ar)?/);
	// And a pip row that a screen reader is spared, because the figure is already spoken.
	await expect(busy.locator('.cal__pips')).toHaveAttribute('aria-hidden', 'true');
});

test('the busiest days link into the days they name', async ({ page }) => {
	await page.goto('/kalender');
	const first = page.locator('.hot__list a.hot__key').first();
	await expect(first).toHaveAttribute('href', /^\/kalender\/\d{4}-\d{2}-\d{2}$/);

	// The bars are decoration on top of a figure that is already written down beside them.
	await expect(page.locator('.hot__track').first()).toHaveAttribute('aria-hidden', 'true');
});

/**
 * The week grid is the one thing on this site that is deliberately wider than a phone: seven
 * readable columns do not fit 320px, so it scrolls inside its own box. That is exactly the shape
 * that leaks into the page when a `min-inline-size` escapes its container, so it gets its own
 * assertion rather than relying on the month view's.
 */
test('the week grid scrolls inside itself rather than pushing the page sideways', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto('/kalender');
	const week = await page.locator('a.rail__bar').first().getAttribute('href');
	await page.goto(week!);

	/*
	 * Asserted by trying to scroll, not by measuring `scrollWidth`.
	 *
	 * This caught a real bug that the measurement alone did not explain: every element outside the
	 * scroller measured exactly 320px, and the page still scrolled 448px sideways, because
	 * `container-type: inline-size` on the scroller implies `contain: layout style inline-size` and
	 * NOT `paint` — so the overflow propagated to the viewport anyway. Asking the window to move is
	 * the only assertion that is about what a reader experiences.
	 */
	const moved = await page.evaluate(() => {
		window.scrollTo(2000, 0);
		const x = window.scrollX;
		window.scrollTo(0, 0);
		return x;
	});
	expect(moved, 'the week view must not scroll sideways at 320px').toBe(0);

	// And the grid itself really is the scroller, so the columns are still reachable.
	const scrollable = await page.evaluate(() => {
		const el = document.querySelector('.week');
		return el ? el.scrollWidth > el.clientWidth : false;
	});
	expect(scrollable).toBe(true);
});
