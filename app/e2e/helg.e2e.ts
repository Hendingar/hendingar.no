import { expect, test } from '@playwright/test';

/**
 * The two weekend pages — what is on now, and what is coming.
 *
 * "What is on this weekend" is the question a local events site is asked most often. It used to be
 * answered by one page at `/neste-helg`, under a name that is ambiguous on a Saturday: grammatically
 * "neste helg" is the weekend *after* this one, and that page deliberately showed the one you were
 * standing in so somebody opening the site on Saturday afternoon still saw that evening's concerts.
 *
 * With `/denne-helga` beside it the compromise is gone and each page means what it says. Which makes
 * the assertion below the important one: the two must never show the same day.
 *
 * The arithmetic itself is covered exhaustively in packages/core — every day of a year. What is
 * asserted here is the half a unit test cannot reach: that both pages are real server-rendered HTML,
 * and that whatever the data happens to be on the day CI runs, nothing outside their weekend appears.
 */

/** 0 = måndag … 6 = sundag, matching `weekdayIndex` in packages/core. */
function weekday(date: string): number {
	const [y, m, d] = date.split('-').map(Number);
	return (new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay() + 6) % 7;
}

/** The dates each day section carries as an id — the only way to check the rule against live data. */
function daysIn(html: string): string[] {
	return [...html.matchAll(/id="day-(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]!);
}

test('the weekend tab is in the masthead and marks itself current', async ({ page }) => {
	await page.goto('/hendingar');
	const tab = page.locator('header a[href="/denne-helga"]');
	await expect(tab).toHaveText('Denne helga');

	await tab.click();
	await expect(page).toHaveURL(/\/denne-helga$/);
	// The section marker is how a reader knows where they are; it was the reason `isCurrent` exists.
	await expect(page.locator('header a[href="/denne-helga"]')).toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('each weekend page links to the other, and marks which one you are on', async ({ page }) => {
	/*
	 * The pair only works if you can get from either to the other. Real links, not JavaScript tabs:
	 * each weekend is a thing you can send someone, and `aria-current` is what tells a screen reader
	 * which is showing — colour alone says it to sighted readers only.
	 */
	for (const [path, here, there] of [
		['/denne-helga', '/denne-helga', '/neste-helg'],
		['/neste-helg', '/neste-helg', '/denne-helga']
	] as const) {
		await page.goto(path);
		const tabs = page.locator('nav[aria-label="Kva helg"] a');
		await expect(tabs).toHaveCount(2);
		await expect(page.locator(`nav[aria-label="Kva helg"] a[href="${here}"]`)).toHaveAttribute(
			'aria-current',
			'page'
		);
		const other = page.locator(`nav[aria-label="Kva helg"] a[href="${there}"]`);
		await expect(other).not.toHaveAttribute('aria-current', 'page');
		await other.click();
		await expect(page).toHaveURL(new RegExp(`${there}$`));
	}
});

for (const [path, heading] of [
	['/denne-helga', 'Denne helga'],
	['/neste-helg', 'Neste helg']
] as const) {
	test(`${path} is server-rendered, not fetched after load`, async ({ request }) => {
		const response = await request.get(path);
		expect(response.status()).toBe(200);

		const html = await response.text();
		expect(html).toContain('<h1');
		expect(html).toContain(heading);
		// A remote query's `loading` is always true during SSR, so a boundary here would ship a
		// placeholder and no events — the trap CLAUDE.md records. This page uses a top-level await.
		expect(html).not.toContain('Lastar');

		// The dates are always printed. Both names are ordinary Norwegian and neither is precise on
		// its own; the range under the heading is what makes the pair a stated choice.
		expect(html).toMatch(
			/(måndag|tysdag|onsdag|torsdag|fredag|laurdag|sundag) \d{1,2}\.[^<]*(januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)/
		);
	});

	test(`nothing outside the weekend ever appears on ${path}`, async ({ request }) => {
		/*
		 * The one regression that would be invisible: an off-by-one in the day arithmetic shows up
		 * as a Thursday quietly listed under a weekend heading for one week in seven.
		 */
		const days = daysIn(await (await request.get(path)).text());

		for (const day of days) {
			expect(weekday(day), `${day} is not a Friday, Saturday or Sunday`).toBeGreaterThanOrEqual(4);
		}

		// Three at most, and no repeats — a weekend, not a week.
		expect(days.length).toBeLessThanOrEqual(3);
		expect(new Set(days).size).toBe(days.length);
	});
}

test('the two weekends never show the same day', async ({ request }) => {
	/*
	 * The assertion the split exists for. Two tabs that could show any of the same days would be
	 * two names for one answer — and worse, a reader planning next weekend would be looking at
	 * tonight. packages/core walks a year proving the date sets cannot overlap; this proves the two
	 * pages actually use them that way.
	 */
	const thisWeekend = daysIn(await (await request.get('/denne-helga')).text());
	const nextWeekend = daysIn(await (await request.get('/neste-helg')).text());

	expect(nextWeekend.filter((d) => thisWeekend.includes(d))).toEqual([]);

	// And next weekend is strictly later, not merely different.
	if (thisWeekend.length > 0 && nextWeekend.length > 0) {
		expect(nextWeekend[0]! > thisWeekend[thisWeekend.length - 1]!).toBe(true);
	}
});

test('a weekend day already gone is not listed on /denne-helga', async ({ request }) => {
	/*
	 * The correction this page needed. Showing the whole Friday-to-Sunday block put Friday's
	 * finished concerts in front of somebody opening the tab on Sunday, which is not what a page
	 * about this weekend is for. `/neste-helg` needs no such guard — a week out, every one of its
	 * days is still ahead.
	 */
	const html = await (await request.get('/denne-helga')).text();
	const days = daysIn(html);

	// With no events, the page still has to say so rather than render an empty shell.
	if (days.length === 0) {
		expect(html).toContain('Ingenting meir denne helga');
		test.skip();
	}

	// The server renders "I dag" for today, so the earliest day shown can be today but never
	// earlier. Compared as strings, which is what YYYY-MM-DD is for.
	const today = new Date().toISOString().slice(0, 10);
	for (const day of days) {
		expect(day >= today, `${day} is before today (${today})`).toBe(true);
	}
});

test('an empty next weekend says it is not collected yet, not that nothing is on', async ({
	request
}) => {
	/*
	 * Most sources publish a fortnight ahead at most and the ingest runs daily, so next weekend
	 * genuinely fills up as it approaches. "Ingenting skjer" would be a claim about Sunnhordland
	 * where the truth is a claim about our data.
	 */
	const html = await (await request.get('/neste-helg')).text();
	if (daysIn(html).length > 0) test.skip();

	expect(html).toContain('Ingenting registrert for neste helg enno');
	expect(html).not.toContain('Ingenting meir denne helga');
});
