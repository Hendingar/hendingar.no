import { expect, test } from '@playwright/test';

/**
 * `/haugen` — the pile, and asking it something.
 *
 * CI has no verifier, so every answer here is text matching. That is deliberate rather than a
 * gap: the ranker is optional (ADR 0022) and the page must be whole without it. What Jev decides
 * is measured by `services/verifier/evals/haugen`, against the real model, where it can be.
 *
 * The rule that outranks the motion is the same one /hendingar keeps: the pile is real links in
 * the server-rendered HTML, and a GET never costs anything.
 */

test('the pile is server-rendered links, one per upcoming event', async ({ request }) => {
	const html = await (await request.get('/haugen')).text();
	const balls = html.match(/class="ball__link/g)?.length ?? 0;

	expect(balls, 'the seed has upcoming events, so the pile is not empty').toBeGreaterThan(5);
	expect(html).toMatch(/href="\/hending\/\d+/);
	expect(html).toContain('Høyr med haugen');
});

test('a question in the address bar is answered by text, without JavaScript', async ({
	browser
}) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto('/haugen?q=konsert');

	const answers = page.locator('.answers li');
	await expect(answers.first()).toBeVisible();
	await expect(page.locator('.answers')).toContainText('Konsert på Den Blå Time');
	// Every listed answer matched the word: text matching floats nothing it cannot point to.
	for (const title of await page.locator('.answer__title').allInnerTexts()) {
		expect(title.toLowerCase()).toContain('konsert');
	}
	// A searched pile is a view, not a page.
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
	await context.close();
});

test('typing asks the pile and says how it answered', async ({ page }) => {
	await page.goto('/haugen');
	await page.locator('#haugen-q').fill('Songkveld');

	// No verifier in CI: the page is honest that this was text matching, not the model — and that
	// it is still asking the model behind the text answer, rather than settling for it.
	const status = page.locator('.ask__status');
	await expect(status).toContainText('av');
	await expect(status).toContainText('tekstsøk', { ignoreCase: true });
	await expect(status).toContainText('spør Jev igjen');
	await expect(page.locator('.answers')).toContainText('Songkveld i Stord kyrkje');
});

test('a suggestion is a link that works, and a question when scripted', async ({ page }) => {
	await page.goto('/haugen');
	const chip = page.locator('.ask__chip', { hasText: 'konsertar' });
	await expect(chip).toHaveAttribute('href', '/haugen?q=konsertar');
	await chip.click();
	await expect(page.locator('#haugen-q')).toHaveValue('konsertar');
	await expect(chip).toHaveClass(/ask__chip--on/);
});

test('reduced motion gets the same pile, standing still', async ({ browser }) => {
	const context = await browser.newContext({ reducedMotion: 'reduce' });
	const page = await context.newPage();
	await page.goto('/haugen');
	await expect(page.locator('.pile .ball').first()).toBeVisible();
	// Give an animating pile every chance to start; it must not.
	await page.waitForTimeout(500);
	await expect(page.locator('.pile--live')).toHaveCount(0);
	await context.close();
});
