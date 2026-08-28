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
	// What happens next is stated on the page, not only after submitting.
	expect(html).toContain('Ein agent sjekkar');
});

test('both submission modes are in the server-rendered HTML', async ({ request }) => {
	const html = await (await request.get('/send-inn')).text();
	// Unconditional, whatever the configuration. Gating the photo tab on VERIFIER_URL made the
	// upload entry point vanish with nothing to explain it — the page looked like it had never
	// offered upload at all.
	expect(html).toContain('Med skjema');
	expect(html).toContain('Med bilete');
	// The tabs are a radio group switched by CSS, not JavaScript. Both panels must therefore be
	// present and the form must be reachable with scripting off — fake tabs would hide it entirely.
	expect(html).toMatch(/id="mode-skjema"[^>]*checked/);
	expect(html).toContain('id="mode-bilete"');
	expect(html).toContain('class="capture frame');
	expect(html).toContain('<form method="POST"');
	// The upload affordances are stated, not just implied by a camera button.
	expect(html).toContain('lime inn eit skjermbilete');
	expect(html).toContain('Facebook-hending');
});

test('switching to the photo tab swaps which panel is visible', async ({ page }) => {
	await page.goto('/send-inn');
	const capture = page.locator('.capture');
	const form = page.locator('form.form');
	await expect(form).toBeVisible();
	await expect(capture).toBeHidden();

	await page.getByText('Med bilete', { exact: true }).click();
	await expect(capture).toBeVisible();
	await expect(form).toBeHidden();

	await page.getByText('Med skjema', { exact: true }).click();
	await expect(form).toBeVisible();
});

test('the file input accepts a library pick, not only the camera', async ({ page }) => {
	await page.goto('/send-inn');
	await page.getByText('Med bilete', { exact: true }).click();
	const input = page.locator('.capture input[type="file"]');
	await expect(input).toHaveAttribute('accept', 'image/*');
	// capture="environment" would open the rear camera directly on a phone, making it impossible
	// to pick an existing screenshot of a Facebook event — half the point of this panel.
	await expect(input).not.toHaveAttribute('capture', /.*/);
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

test('the time fields are 24-hour, whatever the browser locale', async ({ page }) => {
	await page.goto('/send-inn');
	// Not `type="time"`: the native control renders in the browser's locale, so an English-locale
	// browser showed "04:30 PM" on a Nynorsk form and no attribute can override it.
	await expect(page.locator('#startTime')).not.toHaveAttribute('type', 'time');

	await page.locator('#startTime').click();
	await page.keyboard.type('1930');
	await expect(page.locator('#startTime')).toHaveValue('19:30');

	// A leading 3-9 cannot begin a two-digit hour, so 930 means 09:30 — otherwise a numeric
	// keypad user typing 9-3-0 would get "90:3".
	await page.locator('#endTime').click();
	await page.keyboard.type('930');
	await expect(page.locator('#endTime')).toHaveValue('09:30');
});
