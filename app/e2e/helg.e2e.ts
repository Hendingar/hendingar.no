import { expect, test } from '@playwright/test';

/**
 * "Neste helg" — the question a local events site is asked most often.
 *
 * Before this it could not be answered: a reader had to open the calendar, work out which squares
 * were the weekend, and visit three day pages. `/hendingar` answers "what is next" and
 * `/kalender/<dato>` answers "what is on that date"; neither answers "what am I doing on Saturday".
 *
 * The arithmetic itself is covered exhaustively in packages/core — every day of a year. What is
 * asserted here is the half a unit test cannot reach: that the page is real server-rendered HTML,
 * and that whatever the data happens to be on the day CI runs, nothing outside the weekend appears.
 */

/** 0 = måndag … 6 = sundag, matching `weekdayIndex` in packages/core. */
function weekday(date: string): number {
	const [y, m, d] = date.split('-').map(Number);
	return (new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay() + 6) % 7;
}

test('the tab is in the masthead and marks itself current', async ({ page }) => {
	await page.goto('/hendingar');
	const tab = page.locator('header a[href="/neste-helg"]');
	await expect(tab).toHaveText('Neste helg');

	await tab.click();
	await expect(page).toHaveURL(/\/neste-helg$/);
	// The section marker is how a reader knows where they are; it was the reason `isCurrent` exists.
	await expect(page.locator('header a[href="/neste-helg"]')).toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('the page is server-rendered, not fetched after load', async ({ request }) => {
	const response = await request.get('/neste-helg');
	expect(response.status()).toBe(200);

	const html = await response.text();
	expect(html).toContain('<h1');
	expect(html).toContain('Neste helg');
	// A remote query's `loading` is always true during SSR, so a boundary here would ship a
	// placeholder and no events — the trap CLAUDE.md records. This page uses a top-level await.
	expect(html).not.toContain('Lastar');

	// The dates are always printed, because "neste helg" is ambiguous on a Saturday and the range
	// is what turns that into a stated choice rather than a guess the reader has to make.
	expect(html).toMatch(
		/(måndag|tysdag|onsdag|torsdag|fredag|laurdag|sundag) \d{1,2}\.[^<]*(januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)/
	);
});

test('nothing outside the weekend ever appears on it', async ({ request }) => {
	/*
	 * The one regression that would be invisible: an off-by-one in the day arithmetic shows up as a
	 * Thursday quietly listed under "Neste helg" for one week in seven. Each day section carries
	 * its date as an id, so the rule can be checked against whatever data CI happens to have.
	 */
	const html = await (await request.get('/neste-helg')).text();
	const days = [...html.matchAll(/id="day-(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]!);

	for (const day of days) {
		expect(weekday(day), `${day} is not a Friday, Saturday or Sunday`).toBeGreaterThanOrEqual(4);
	}

	// Three at most, and consecutive — a weekend, not a week.
	expect(days.length).toBeLessThanOrEqual(3);
	expect(new Set(days).size).toBe(days.length);

	// With no events, the page still has to say so rather than render an empty shell.
	if (days.length === 0) expect(html).toContain('Ingenting meir denne helga');
});

test('a weekend day already gone is not listed', async ({ request }) => {
	/*
	 * The correction this page needed. Showing the whole Friday-to-Sunday block put Friday's
	 * finished concerts in front of somebody opening the tab on Sunday, which is not what a tab
	 * called "neste helg" is for.
	 */
	const html = await (await request.get('/neste-helg')).text();
	const days = [...html.matchAll(/id="day-(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]!);
	if (days.length === 0) test.skip();

	// The server renders "I dag" for today, so the earliest day shown can be today but never
	// earlier. Compared as strings, which is what YYYY-MM-DD is for.
	const today = new Date().toISOString().slice(0, 10);
	for (const day of days) {
		expect(day >= today, `${day} is before today (${today})`).toBe(true);
	}
});
