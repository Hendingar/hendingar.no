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

test('a standing card is a row on a phone, not a screenful', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/alltid-ope');

	const card = page.locator('article.card').first();
	const box = (await card.boundingBox())!;
	/*
	 * Poster-on-top, one of these was 400px on a 390×844 phone — so the four on the front page cost
	 * 1600px, four times what the four event rows above them cost, for the section that is
	 * explicitly the afterthought of the page. The same row treatment `EventTile` gives itself at
	 * the same width brings it to about 120.
	 */
	expect(box.height, 'a standing card must not take most of a phone screen').toBeLessThan(180);

	// Text left, thumbnail right. If the picture is back on top, the height above is the only thing
	// holding the layout — and it would not hold it for long.
	const thumb = (await card.locator('.thumb').boundingBox())!;
	const title = (await card.locator('.card__t').boundingBox())!;
	expect(thumb.x, 'the thumbnail sits beside the text').toBeGreaterThan(title.x);
	expect(Math.abs(thumb.y - title.y), 'the thumbnail is not stacked above the title').toBeLessThan(
		box.height
	);
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

/*
 * The weekly activities — clubs, choirs, a parish's services — read by day, then by club.
 *
 * The seed carries three, from two organisers: "Fotball G12" (12 år; tysdag, onsdag, laurdag),
 * "Turn 5-6 år" (onsdag) and a fortnightly "Gudsteneste". They are `standing` rows like the escape
 * room, so every guard above keeps them out of the day lists; what is asserted here is the page
 * that holds them, and that they never leak into the places.
 *
 * Days are asked for by name in the URL, because "i dag" moves with the clock and a spec that
 * passes only on Tuesdays is the flaky test rule 6 forbids.
 */
test('the day lens is server-rendered from the URL', async ({ request }) => {
	const html = await (await request.get('/alltid-ope?dag=tysdag')).text();
	const lens = html.match(/<section id="dag"[\s\S]*?<\/section>/)?.[0];
	expect(lens, 'the lens must be in the HTML, not filled in after hydration').toBeTruthy();

	// The chosen day is marked, and what meets that day is listed with its time.
	expect(lens).toMatch(/aria-current="date"[^>]*>\s*<span class="day__short[^"]*">Ty</);
	expect(lens).toContain('Fotball G12');
	expect(lens).toContain('18:00');
	// Turn meets on onsdag only.
	expect(lens).not.toContain('Turn 5-6 år');
	expect(lens).not.toContain('Lastar');
});

test('the age filter narrows to who it is for, by the range the source states', async ({
	request
}) => {
	const lens = async (query: string) =>
		(await (await request.get(`/alltid-ope?${query}`)).text()).match(
			/<section id="dag"[\s\S]*?<\/section>/
		)?.[0] ?? '';

	// Onsdag: a 12-year-olds' squad and a 5–6 turn group are both for children…
	const born = await lens('dag=onsdag&for=born');
	expect(born).toContain('Fotball G12');
	expect(born).toContain('Turn 5-6 år');

	// …and neither is for adults. A filter that showed them would be the site deciding for the
	// club who its squad is for.
	const vaksne = await lens('dag=onsdag&for=vaksne');
	expect(vaksne).not.toContain('Fotball G12');
	expect(vaksne).not.toContain('Turn 5-6 år');

	// Choosing a band keeps the day, and choosing a day keeps the band.
	expect(born).toMatch(/href="\/alltid-ope\?dag=onsdag&amp;for=vaksne#dag"/);
	expect(born).toMatch(/href="\/alltid-ope\?dag=tysdag&amp;for=born#dag"/);
});

test('picking a day works without JavaScript', async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto('/alltid-ope?dag=tysdag');
	await page
		.getByRole('navigation', { name: 'Vel dag' })
		.getByRole('link', { name: /^onsdag/ })
		.click();
	await expect(page).toHaveURL(/dag=onsdag/);
	await expect(page.locator('#dag')).toContainText('Turn 5-6 år');
	await context.close();
});

test('the clubs are cards with the days they meet', async ({ request }) => {
	const html = await (await request.get('/alltid-ope')).text();
	const clubs = html.match(/<section class="clubs[\s\S]*?<\/section>/)?.[0];
	expect(clubs, 'the club grid must be server-rendered').toBeTruthy();

	const cards =
		clubs!.match(/<li class="club[\s\S]*?(?=<li class="club|<\/ul>\s*<\/section>)/g) ?? [];
	const club = cards.find((c) => c.includes('Seed Idrettslag'));
	expect(club, 'the club has a card of its own').toBeTruthy();
	expect(club).toContain('2 aktivitetar');
	expect(club).toContain('Fotball G12');
	expect(club).not.toContain('Gudsteneste');
	// The pip strip is a picture with words for those who cannot see it.
	expect(club).toMatch(/aria-label="Møtest tysdag, onsdag og laurdag"/);

	// A fortnightly service says so wherever its time is shown.
	const parish = cards.find((c) => c.includes('Seed Kyrkjelyd'));
	expect(parish).toContain('Partalsveker');
});

test('a weekly activity is never shown as a place', async ({ request }) => {
	/*
	 * The front-page band, the "Òg ope denne dagen" line and the places grid all read
	 * `standingOffers`. If the timetable filter comes off it, every one of them fills with football
	 * squads, and nothing else on the page would look wrong.
	 */
	const page = await (await request.get('/alltid-ope')).text();
	const cards = page.match(/<article class="card[\s\S]*?<\/article>/g) ?? [];
	expect(cards.length).toBeGreaterThan(0);
	for (const card of cards) expect(card).not.toMatch(/Fotball G12|Gudsteneste/);

	for (const path of ['/', '/hendingar', '/denne-helga', '/neste-helg']) {
		const html = await (await request.get(path)).text();
		const shown = [
			...(html.match(/<article class="(tile|card)[\s\S]*?<\/article>/g) ?? []),
			...(html.match(/<aside class="also[\s\S]*?<\/aside>/g) ?? [])
		];
		for (const block of shown) {
			expect(block, `${path} showed a weekly activity`).not.toMatch(/Fotball G12|Gudsteneste/);
		}
	}
});

test('a weekly activity’s page says when it meets, not midnight on its first day', async ({
	page
}) => {
	await page.goto('/alltid-ope?dag=tysdag');
	await page.locator('#dag').getByRole('link', { name: 'Fotball G12' }).click();
	await expect(page).toHaveURL(/\/hending\/\d+-/);

	const when = page.locator('dd.weekly');
	await expect(when).toContainText('Tysdag og onsdag 18:00–19:30');
	await expect(when).toContainText(/Til \w+ \d+\. \w+ \d{4}/);
	await expect(page.locator('.facts')).not.toContainText('00:00');
});

test('/alltid-ope does not scroll sideways at 320px', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 700 });
	await page.goto('/alltid-ope?dag=onsdag');
	for (const summary of await page.locator('details.club__more > summary').all())
		await summary.click();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});
