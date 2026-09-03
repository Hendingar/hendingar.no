import { expect, test } from '@playwright/test';

/** The front-page grid and the status board — both must be real without JavaScript. */

test('the listing is server-rendered above the brand hero', async ({ request }) => {
	const html = await (await request.get('/')).text();
	expect(html).not.toContain('Lastar…');
	expect(html.match(/<article class="tile/g)?.length).toBeGreaterThan(0);
	// It comes before the hero in document order — that is the whole point of the change.
	const grid = html.indexOf('h-up');
	const hero = html.indexOf('hero__word');
	expect(grid).toBeGreaterThan(-1);
	expect(hero).toBeGreaterThan(-1);
	expect(grid).toBeLessThan(hero);
});

test('events are grouped under day headings, today first', async ({ page }) => {
	await page.goto('/');
	const headings = await page.locator('.day__h').allInnerTexts();
	expect(headings.length).toBeGreaterThan(1);
	// The first group is today (or tomorrow, on a day with nothing on).
	expect(headings[0]).toMatch(/I dag|I morgon/i);
	// Each group is its own labelled region, so the date is structural, not just visual.
	for (const h of await page.locator('section.day').all()) {
		await expect(h).toHaveAttribute('aria-labelledby', /^day-\d{4}-\d{2}-\d{2}$/);
	}
});

test('a still-running multi-day event is grouped under today, not its start date', async ({
	page
}) => {
	await page.goto('/');
	const first = page.locator('section.day').first();
	await expect(first.locator('.day__h')).toContainText(/I dag/i);
	// The seeded exhibition opened days ago and runs for another week.
	await expect(first).toContainText(/Utstilling: Havet og oss/i);
});

test('every tile has a thumbnail and offers more', async ({ page }) => {
	await page.goto('/');
	const tiles = page.locator('article.tile');
	const n = await tiles.count();
	expect(n).toBeGreaterThan(0);
	for (let i = 0; i < n; i++) {
		await expect(tiles.nth(i).locator('.thumb')).toHaveCount(1);
	}
	await expect(page.getByRole('link', { name: 'Vis fleire' })).toBeVisible();
});

test('an imported tile shows the mark of the source it came from', async ({ page }) => {
	await page.goto('/');
	const marks = page.locator('article.tile .tile__src');
	// Every seeded event is imported, so every tile carries a mark. A published submission would
	// legitimately have none — the assertion is that imported events never lose their attribution,
	// which is the README's "we are an index, not a replacement" made visible on the card.
	expect(await marks.count()).toBeGreaterThan(0);
	for (const mark of await marks.all()) {
		// The source is named for a pointer user even though the icon is decorative for a reader.
		await expect(mark).toHaveAttribute('title', /^Kjelde: .+/);
		expect(await mark.locator('.icon').count()).toBe(1);
	}
});

test('a source is one compact row until you open it', async ({ page }) => {
	await page.goto('/datasamling');
	await expect(page.getByRole('heading', { level: 1, name: /kjelder/i })).toBeVisible();

	const row = page.locator('details.row').filter({ hasText: /det skjer sunnhordland/i });
	await expect(row).toBeVisible();
	// Scannable without opening: who it is, how we collect it.
	await expect(row).toContainText('JSON-API');
	// The detail is deliberately not on screen yet — that is the whole point of the change.
	// Scoped to this row: with more than one collected source, a page-wide text match resolves to
	// every source's schedule and says nothing about whether THIS row is closed.
	await expect(row.getByText(/dagleg \d{2}:\d{2} UTC/)).toBeHidden();

	await row.locator('summary').click();
	await expect(row.getByText(/dagleg \d{2}:\d{2} UTC/)).toBeVisible();
	await expect(row).toContainText('detskjer.sunnhordland.no/api/events');
});

test('datasamling shows run history rather than claiming a status', async ({ page }) => {
	await page.goto('/datasamling');
	// A *collected* row, not merely the first one: sources are ordered by name, and a linked
	// source that we deliberately do not collect has no run history to show.
	await page.locator('details.row:not([data-kind="link"])').first().locator('summary').click();
	const strip = page.getByRole('list', { name: /siste køyringar/i });
	await expect(strip).toBeVisible();
	expect(await strip.locator('li').count()).toBeGreaterThan(0);
});

test('a source we do not collect says so and links out instead', async ({ page }) => {
	await page.goto('/datasamling');
	const linked = page.locator('details.row[data-kind="link"]');
	expect(await linked.count()).toBeGreaterThan(0);

	const first = linked.first();
	// The chip must not read like a broken importer — "Ikkje køyrt" is what a stopped one shows.
	await expect(first.locator('.state')).toHaveText('Ikkje henta');
	await first.locator('summary').click();
	// No run strip, because there are no runs to claim.
	await expect(first.getByRole('list', { name: /siste køyringar/i })).toHaveCount(0);
	// And the point of listing it at all: somewhere for a reader to go.
	await expect(first.getByRole('link', { name: /^Opne / })).toBeVisible();
});

test('every source row carries an icon or its initials', async ({ page }) => {
	await page.goto('/datasamling');
	for (const row of await page.locator('details.row').all()) {
		// One or the other, never neither: the row layout reserves the space either way.
		expect(await row.locator('.icon').count()).toBe(1);
	}
});

test('the submission log lists what people sent and what was decided', async ({ page }) => {
	await page.goto('/datasamling');
	const log = page.locator('.log');
	await expect(log).toBeVisible();
	const entries = await log.locator('.entry').all();
	// Structure, not specific rows. The log shows only the five most recent submissions, and the
	// submission specs run in parallel with this file — asserting on a seeded title meant asserting
	// that nothing else had been submitted yet, which is a race, not a requirement.
	expect(entries.length).toBeGreaterThan(0);
	expect(entries.length).toBeLessThanOrEqual(5);
	for (const entry of entries) {
		await expect(entry).toHaveAttribute('data-status', /published|pending|rejected/);
		await expect(entry.locator('.entry__method')).toHaveCount(1);
		await expect(entry.locator('.entry__status')).not.toBeEmpty();
	}
});

test('a rejected submission never has its text republished', async ({ page }) => {
	await page.goto('/datasamling');
	// The mapping rule itself is unit-tested in packages/core (publicSubmissionTitle) because
	// whether a given rejected row is inside the five-row window depends on what else was
	// submitted. What is always true, and worth asserting on the real page, is the outcome:
	// the seed's rejected row is advertising copy, and it must never appear anywhere.
	await expect(page.locator('body')).not.toContainText('BILLIGE KLOKKER');
	// And any rejected row that IS on screen shows the placeholder rather than its own title.
	for (const rejected of await page.locator('.entry[data-status="rejected"]').all()) {
		await expect(rejected).toContainText('Tilbakehalden tittel');
	}
});

test('site navigation reaches both pages', async ({ page }) => {
	await page.goto('/');
	await page
		.getByRole('navigation', { name: 'Hovudmeny' })
		.getByRole('link', { name: 'Kjelder' })
		.click();
	await expect(page).toHaveURL(/\/datasamling$/);
	await expect(page.getByRole('link', { name: /^Kjelder/ }).first()).toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('no horizontal overflow on the new pages', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	for (const path of ['/', '/datasamling', '/hendingar', '/send-inn']) {
		await page.goto(path);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow, `${path} at 320px`).toBe(0);
	}
});
