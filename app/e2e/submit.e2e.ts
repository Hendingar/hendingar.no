import { expect, test } from '@playwright/test';

/**
 * The submission page. Two things are load-bearing and both are easy to break silently:
 * the form must exist in the server-rendered HTML (no JavaScript required to submit an event),
 * and the photo shortcut must be absent when no verifier is configured rather than offering a
 * button that cannot work.
 */

test('the form is server-rendered, with every required field', async ({ request }) => {
	const html = await (await request.get('/send-inn')).text();
	expect(html).toContain('<form method="POST"');
	// Remote forms namespace input names (`title/<hash>/submitEvent`), so match on the prefix.
	for (const field of ['title', 'category', 'date', 'startTime', 'venueName', 'method']) {
		expect(html).toMatch(new RegExp(`name="${field}/`));
	}
	// The five checks are explained on the page itself, not just after submitting.
	expect(html).toContain('Fem kontrollar');
});

test('the photo shortcut is hidden when no verifier is configured', async ({ request }) => {
	const html = await (await request.get('/send-inn')).text();
	// E2E runs without VERIFIER_URL. A dead camera button is worse than no camera button.
	expect(html).not.toContain('class="capture frame');
});

test('an incomplete submission is rejected in the browser, not by the server', async ({ page }) => {
	await page.goto('/send-inn');
	await page.getByRole('button', { name: /Send inn hendinga/ }).click();
	// Native constraint validation keeps focus in the form; nothing was submitted.
	await expect(page.locator('#title')).toBeFocused();
});

test('a complete submission returns a verdict with reasoning for every check', async ({ page }) => {
	await page.goto('/send-inn');
	await page.locator('#title').fill('Testkonsert i Leirvik');
	await page.locator('#category').selectOption('musikk');
	await page.locator('#date').fill('2027-03-14');
	await page.locator('#startTime').fill('19:30');
	await page.locator('#venueName').fill('Stord kulturhus');
	await page.getByRole('button', { name: /Send inn hendinga/ }).click();

	const verdict = page.locator('.verdict');
	await expect(verdict).toBeVisible();
	// With no verifier reachable, the honest outcome is a human queue — never a silent publish.
	await expect(verdict.locator('#verdict-h')).toHaveText('Til gjennomgang');
	await expect(verdict.locator('.check')).toHaveCount(1);
	await expect(verdict.locator('.check__reasoning')).toContainText(/manuell/i);
});

test('the page is reachable from the site navigation', async ({ page }) => {
	await page.goto('/');
	await page
		.getByRole('navigation', { name: 'Hovudmeny' })
		.getByRole('link', { name: 'Send inn' })
		.click();
	await expect(page).toHaveURL(/\/send-inn$/);
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Veit du om');
});
