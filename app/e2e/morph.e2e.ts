import { expect, test, type Page } from '@playwright/test';

/**
 * The card-to-page morph: a tapped card's poster and title become the event page's.
 *
 * A transition cannot be screenshotted, but everything that actually breaks one can be asserted.
 * Three things go wrong in practice, and all three are silent:
 *
 * - A `view-transition-name` repeated anywhere in the document. The browser does not pick one, it
 *   abandons the ENTIRE transition — every morph on the page, not just the clashing pair — and
 *   reports nothing. A listing renders two dozen cards, so this is the failure mode with teeth.
 * - The name on the card and the name on the event page not matching, which turns the morph into
 *   two unrelated fades that look almost, but not quite, like the cross-fade it replaced.
 * - Motion arriving for a reader who asked for none.
 *
 * The fourth spec closes the loop. It wraps `startViewTransition` to record what the names in the
 * document actually were at the instant the browser took its snapshot — the only moment that
 * counts, since names present a frame earlier or later would prove nothing — and then waits on the
 * transition's own `ready` promise, which is the browser stating outright that it accepted the
 * names and is animating them.
 */

/** Every morph name in the document right now, as the browser resolves it, in document order. */
function morphNames(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		[...document.querySelectorAll('.vt-morph')].map((element) =>
			getComputedStyle(element).getPropertyValue('view-transition-name').trim()
		)
	);
}

/**
 * Record what the browser was handed, and what it made of it, on the one element that survives a
 * client-side navigation.
 *
 * Attributes on `<html>` rather than globals: they are readable with an auto-retrying Playwright
 * assertion, and they need no `Window` declaration merged into the project's types.
 *
 * `ready` is the interesting half. It rejects when the transition is abandoned — which is exactly
 * what a duplicated `view-transition-name` causes, and the reason that failure is invisible. A
 * spec that only counted names in the DOM would still pass against a page the browser refused to
 * animate; this one does not.
 */
async function recordViewTransition(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const start = document.startViewTransition;
		if (!start) return;
		document.startViewTransition = (callback) => {
			document.documentElement.setAttribute(
				'data-morph-snapshot',
				[...document.querySelectorAll('.vt-morph')]
					.map((element) =>
						getComputedStyle(element).getPropertyValue('view-transition-name').trim()
					)
					.join(' ')
			);
			const transition = start.call(document, callback);
			void transition.ready.then(
				() => document.documentElement.setAttribute('data-morph-ready', 'running'),
				() => document.documentElement.setAttribute('data-morph-ready', 'abandoned')
			);
			return transition;
		};
	});
}

const MORPH_NAME = /^event-(poster|title)-\d+$/;

/*
 * Both listings, because the names live in the shared tile rather than in either route. /kalender
 * and /hjarta render the same component and are covered by that fact; the day page is checked
 * below anyway, since it reaches the tile through EventGrid rather than EventsByDay.
 */
for (const path of ['/', '/hendingar']) {
	test(`every poster and title on ${path} carries its own morph name`, async ({ page }) => {
		await page.goto(path);
		await expect(page.locator('article.tile').first()).toBeVisible();

		const names = await morphNames(page);

		// The seed alone is sixteen events over several days, a third of them with a poster.
		expect(names.length).toBeGreaterThan(10);
		for (const name of names) expect(name).toMatch(MORPH_NAME);
		// Both halves are exercised, so a card that lost its thumbnail cannot pass this quietly.
		expect(names.filter((name) => name.startsWith('event-poster-')).length).toBeGreaterThan(0);
		expect(names.filter((name) => name.startsWith('event-title-')).length).toBeGreaterThan(5);

		// The one that matters: a single repeat here would cancel every morph on the page.
		expect(new Set(names).size).toBe(names.length);
	});
}

test('a day page reaches the same names through its own grid', async ({ page }) => {
	await page.goto('/kalender');
	// Follow the calendar's own link rather than naming a date: the seed is relative to now.
	await page.locator('a.cal__day').first().click();
	await page.waitForURL(/\/kalender\/\d{4}-\d{2}-\d{2}/);
	await expect(page.locator('article.tile').first()).toBeVisible();

	const names = await morphNames(page);
	expect(names.length).toBeGreaterThan(0);
	for (const name of names) expect(name).toMatch(MORPH_NAME);
	expect(new Set(names).size).toBe(names.length);
});

test('the tapped card and the page it opens carry the same two names', async ({ page }) => {
	await page.goto('/hendingar');

	// A card with a real poster, so both halves of the pair are under test rather than just one.
	const card = page.locator('article.tile:has(img.thumb)').first();
	await expect(card).toBeVisible();
	const onCard = await card.evaluate((element) =>
		[...element.querySelectorAll('.vt-morph')].map((named) =>
			getComputedStyle(named).getPropertyValue('view-transition-name').trim()
		)
	);
	expect(onCard).toHaveLength(2);

	await card.locator('a.tile__link').click();
	await page.waitForURL(/\/hending\//);
	await expect(page.locator('h1.ev__h')).toBeVisible();

	// Same names, same event: this is what makes the browser morph rather than cross-fade.
	const onPage = await morphNames(page);
	expect(onPage).toHaveLength(2);
	expect([...onPage].sort()).toEqual([...onCard].sort());
	// And still unique, so the event page cannot cancel its own half of the transition.
	expect(new Set(onPage).size).toBe(onPage.length);
});

test('the browser is handed exactly the tapped card at the moment it snapshots', async ({
	page
}) => {
	// Stated rather than inherited: the whole point of the next spec is the opposite setting.
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await recordViewTransition(page);
	await page.goto('/hendingar');

	const card = page.locator('article.tile:has(img.thumb)').first();
	await expect(card).toBeVisible();
	const wanted = await card.evaluate((element) =>
		[...element.querySelectorAll('.vt-morph')].map((named) =>
			getComputedStyle(named).getPropertyValue('view-transition-name').trim()
		)
	);

	await card.locator('a.tile__link').click();
	await page.waitForURL(/\/hending\//);

	// The transition ran at all — which is the half that lives in +layout.svelte.
	await expect(page.locator('html')).toHaveAttribute('data-morph-snapshot', /event-title-\d+/);
	const attribute = await page.locator('html').getAttribute('data-morph-snapshot');
	const captured = (attribute ?? '').split(' ');

	// The tapped card's pair was in the old state the browser froze, and nothing was doubled.
	for (const name of wanted) expect(captured).toContain(name);
	expect(new Set(captured).size).toBe(captured.length);

	/*
	 * And the browser kept it. `ready` resolving is the browser saying it built the pseudo-element
	 * tree and started animating — the same promise it rejects when a repeated name makes it drop
	 * the whole transition. This is as close to watching the morph as a headless assertion gets.
	 */
	await expect(page.locator('html')).toHaveAttribute('data-morph-ready', 'running');
});

test('reduced motion removes the names, so nothing morphs and nothing is snapshotted', async ({
	page
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await recordViewTransition(page);
	await page.goto('/hendingar');

	const card = page.locator('article.tile:has(img.thumb)').first();
	await expect(card).toBeVisible();

	/*
	 * The elements are still there and still marked — it is the name that is withdrawn. Asserting
	 * the count first is what stops this passing against an empty listing.
	 */
	const names = await morphNames(page);
	expect(names.length).toBeGreaterThan(10);
	expect(new Set(names)).toEqual(new Set(['none']));

	await card.locator('a.tile__link').click();
	await page.waitForURL(/\/hending\//);
	await expect(page.locator('h1.ev__h')).toBeVisible();

	// Belt and braces: +layout.svelte also declines to start a transition at all, so neither
	// attribute is ever written.
	await expect(page.locator('html')).not.toHaveAttribute('data-morph-snapshot', /./);
	await expect(page.locator('html')).not.toHaveAttribute('data-morph-ready', /./);
	expect(new Set(await morphNames(page))).toEqual(new Set(['none']));
});
