import { expect, test } from '@playwright/test';

/**
 * These assert the things that were silently broken and that neither typecheck nor lint can see.
 */

test('events are in the server-rendered HTML, not fetched by the client', async ({ request }) => {
	// Requested without a browser, so nothing executes JS — this is what a crawler and a no-JS
	// visitor receive. Previously it contained the string "Lastar…" and zero events.
	const res = await request.get('/');
	expect(res.ok()).toBeTruthy();
	const html = await res.text();
	expect(html).not.toContain('Lastar…');
	expect(html).toMatch(/<article class="tile/);
});

test('the page has one h1, named for the product', async ({ page }) => {
	await page.goto('/');
	// Accessible name, not text content: two block-level spans stack the word visually and used to
	// make this announce as "HEND INGAR".
	await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(/hendingar/i);
});

test('main landmark and a working skip link', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('main#innhald')).toHaveCount(1);
	await page.keyboard.press('Tab');
	await expect(page.getByRole('link', { name: 'Gå til innhaldet' })).toBeFocused();
});

test('no horizontal overflow at 320px', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	for (const path of ['/', '/hendingar']) {
		await page.goto(path);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow, `${path} must not scroll sideways at 320px`).toBe(0);
	}
});

test('event titles are headings so a long list is navigable', async ({ page }) => {
	await page.goto('/hendingar');
	await expect(page.getByRole('heading', { level: 1, name: /alle hendingar/i })).toBeVisible();
	// At least one event heading — they were <strong> before, invisible to heading navigation.
	expect(await page.getByRole('heading', { level: 2 }).count()).toBeGreaterThan(0);
});

test('health endpoint reports the database', async ({ request }) => {
	const res = await request.get('/health');
	expect(res.status()).toBe(200);
	expect(await res.json()).toMatchObject({ status: 'ok', database: 'ok' });
});

test('the front page says what the list covers, in the server-rendered HTML', async ({
	request
}) => {
	// The honest answer to "is this everything?" used to live only on /datasamling, which most
	// visitors never open. Requested without a browser, because a crawler and a no-JS visitor must
	// get the same context a reader does.
	const html = await (await request.get('/')).text();
	const coverage = html.match(/<aside class="coverage[^"]*"[\s\S]*?<\/aside>/)?.[0];
	expect(coverage, 'the coverage strip must be server-rendered').toBeTruthy();
	// A count of sources, a count of events, and the region — read from data, not written as copy.
	expect(coverage).toMatch(/kjelde/i);
	expect(coverage).toMatch(/hendingar framover/i);
	expect(coverage).toMatch(/Sunnhordland/);
	// And the limit stated plainly, which is the part a status line usually leaves out.
	expect(coverage).toMatch(/ikkje alt som skjer/i);
});

test('the front page does not advertise features that do not exist', async ({ request }) => {
	const html = await (await request.get('/')).text();

	// The page once promised a map, RSS/iCal and a searchable list under a heading reading "Kva
	// det gjer". None of the three is built. That section has since been removed altogether — but
	// this guard was never about the section, it was about the claim, so it now reads everything
	// the page says about *us* rather than one list inside it.
	//
	// Sliced from the hero, which is where the event content ends. An imported event may quite
	// legitimately be a "Kart og kompass-kurs" — DNT runs them — and that is a fact about
	// Sunnhordland, not a promise about this software. Matching the whole document would fail the
	// day someone in the region schedules one.
	const heroAt = html.search(/<header[^>]*class="hero/);
	expect(heroAt, 'the page must still introduce itself after the events').toBeGreaterThan(-1);

	// Read the words, not the markup. Matching raw HTML fails on `label--vertical`, which contains
	// "ical" — the assertion is about what the page *says*, so strip everything that is not said.
	const about = html
		.slice(heroAt)
		.replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, '')
		.replace(/<[^>]+>/g, ' ');

	for (const absent of [/\bkart\b/i, /\bRSS\b/, /iCal/i, /søkbar/i]) {
		expect(about, `the front page must not claim ${absent}`).not.toMatch(absent);
	}
});

test('the front page shows the event list once, not twice', async ({ request }) => {
	const html = await (await request.get('/')).text();
	// There used to be two lists of the same query either side of the manifesto — the second with a
	// smaller limit — so a visitor scrolled past the events, read three sections about us, and met
	// the events again.
	expect(html.match(/<section class="shell now/g) ?? []).toHaveLength(0);
	expect(html.match(/day__h/g)?.length ?? 0).toBeGreaterThan(0);
});
