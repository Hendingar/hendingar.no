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
	const heading = /class="[^"]*months__now[^"]*"[^>]*>([^<]+)</.exec(current)?.[1]?.trim();
	expect(heading).toMatch(/^[A-ZÅÆØ]\p{L}+ \d{4}$/u);

	for (const bad of ['tull', '2026-13', '2019-01']) {
		const response = await request.get(`/kalender?maanad=${bad}`);
		expect(response.status()).toBe(200);
		const shown = /class="[^"]*months__now[^"]*"[^>]*>([^<]+)</.exec(await response.text())?.[1];
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
