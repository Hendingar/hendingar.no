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
	/*
	 * What happens next is stated on the page, not only after submitting — and that now includes
	 * the two-day window, because deleting somebody's submission is not something to mention only
	 * once it has happened.
	 */
	expect(html).toMatch(/Fem kontrollar går/);
	expect(html).toMatch(/48 timar/);
	expect(html).toMatch(/href="\/ko"/);
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
	/*
	 * With no verifier reachable the submission is declined, never silently published.
	 *
	 * It used to say "Til gjennomgang" — a human queue with nobody in it, which is a slower no that
	 * nobody is ever told about. `declined` says the same thing honestly and points at the check
	 * that could not run.
	 */
	await expect(verdict.locator('#verdict-h')).toHaveText('Ikkje publisert');
	await expect(verdict.locator('.verdict__head')).toHaveAttribute('data-outcome', 'declined');
	await expect(verdict.locator('.check')).toHaveCount(1);
	// It names the queue, not a person: there is no manual review any more, and the sender's route
	// forward is /kø rather than waiting.
	await expect(verdict.locator('.check__reasoning')).toContainText(/køen din/i);
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

test('the recurrence fields appear only when something repeats', async ({ page }) => {
	await page.goto('/send-inn');
	await expect(page.locator('#repeats')).toHaveValue('nei');
	await expect(page.locator('.days')).toBeHidden();
	await expect(page.locator('label[for="date"]')).toHaveText(/^dato$/i);

	await page.locator('#repeats').selectOption('weekly');
	await expect(page.locator('.days')).toBeVisible();
	// The date field is the FIRST occurrence once a rule is set, and says so.
	await expect(page.locator('label[for="date"]')).toHaveText(/første dato/i);

	await page.locator('.day').filter({ hasText: 'tor' }).click();
	// The rule is echoed in words, so nobody has to reason about checkboxes in their head.
	await expect(page.locator('.repeat__echo')).toContainText('kvar torsdag');
});

test('a weekly submission is stored as many dates, not one', async ({ page }) => {
	await page.goto('/send-inn');
	await page.locator('#title').fill('E2E vekentleg quiz');
	await page.locator('#category').selectOption('anna');
	await page.locator('#date').fill('2027-03-04'); // a Thursday
	await page.locator('#startTime').click();
	await page.keyboard.type('1900');
	await page.locator('#venueName').fill('Kaikanten');
	await page.locator('#repeats').selectOption('weekly');
	await page.locator('.day').filter({ hasText: 'tor' }).click();

	await page.getByRole('button', { name: /Send inn hendinga/ }).click();
	const verdict = page.locator('.verdict');
	await expect(verdict).toBeVisible();
	// The summary states how many dates were written — a series that silently stored one row would
	// look identical to a working one without this.
	await expect(verdict.locator('.verdict__summary')).toContainText(/\d+ datoar/);
	await expect(verdict.locator('.verdict__summary')).toContainText('kvar torsdag');
});

test('a rule that matches no dates is refused rather than stored empty', async ({ page }) => {
	await page.goto('/send-inn');
	await page.locator('#title').fill('E2E umogleg gjentaking');
	await page.locator('#category').selectOption('anna');
	await page.locator('#date').fill('2027-03-04'); // Thursday
	await page.locator('#startTime').click();
	await page.keyboard.type('1900');
	await page.locator('#venueName').fill('Kaikanten');
	await page.locator('#repeats').selectOption('weekly');
	await page.locator('.day').filter({ hasText: 'tor' }).click();
	// Until the day before the first occurrence: the rule can never fire.
	await page.locator('#repeatUntil').fill('2027-03-03');

	await page.getByRole('button', { name: /Send inn hendinga/ }).click();
	// Caught by the schema, before anything is written.
	await expect(page.locator('.field__error')).toContainText(/sluttdato/i);
});

/**
 * The verdict has a URL, and the URL survives a reload.
 *
 * Before this the answer lived only in the form component's state: reloading discarded it, the
 * back button discarded it, and there was nothing to keep open in a tab while fixing the thing it
 * complained about. `pushState` gives it an address without navigating — which matters because the
 * poster the fields were read from exists only in this browser and is never uploaded unless the
 * submission is approved, so a real navigation would throw the picture away mid-read.
 */
test('a verdict gets an address, and reloading it still shows the verdict', async ({ page }) => {
	await page.goto('/send-inn');
	await page.locator('#title').fill('E2E kvittering på ei adresse');
	await page.locator('#category').selectOption('anna');
	await page.locator('#date').fill('2027-05-19');
	await page.locator('#startTime').fill('11:00');
	await page.locator('#venueName').fill('Vinsen');
	await page.getByRole('button', { name: /Send inn hendinga/ }).click();

	await expect(page.locator('.verdict')).toBeVisible();
	await expect(page).toHaveURL(/\/send-inn\/kvittering\/\d+$/);

	// The whole point: this is a real route, not only a decorated address bar.
	await page.reload();
	await expect(page.locator('.verdict')).toBeVisible();
	await expect(page.locator('.verdict__head')).toHaveAttribute('data-outcome', 'declined');

	// And back returns to the form rather than leaving the site.
	await page.goBack();
	await expect(page).toHaveURL(/\/send-inn$/);
	await expect(page.locator('#title')).toBeVisible();
});

test('a verdict belonging to another browser is not readable', async ({ page, context }) => {
	await page.goto('/send-inn');
	await page.locator('#title').fill('E2E ikkje din kvittering');
	await page.locator('#category').selectOption('anna');
	await page.locator('#date').fill('2027-05-20');
	await page.locator('#startTime').fill('12:00');
	await page.locator('#venueName').fill('Vinsen');
	await page.getByRole('button', { name: /Send inn hendinga/ }).click();
	await expect(page).toHaveURL(/\/send-inn\/kvittering\/\d+$/);
	const url = page.url();

	/*
	 * The id is a bearer token, not a credential. Clearing the browser id is exactly what somebody
	 * guessing an id from another machine looks like from the server's side.
	 */
	await context.clearCookies();
	await page.evaluate(() => localStorage.clear());
	await page.goto(url);
	await expect(page.locator('.verdict')).toHaveCount(0);
	await expect(page.getByText('Fann ikkje denne kvitteringa')).toBeVisible();
});

/**
 * The photo entry point can be linked to directly.
 *
 * One direction only: the URL opens the tab, the tab does not rewrite the URL. Syncing it back
 * with `replaceState` re-runs the page, and the re-run unchecks the radio the click just checked —
 * which breaks the tabs entirely, including for readers with JavaScript off, who are the reason
 * the tabs are radios rather than buttons in the first place.
 */
test('the photo panel can be opened straight from a URL', async ({ page }) => {
	await page.goto('/send-inn?med=bilete');
	// The radio backing the tab, not a class: it is what actually drives the CSS panel switch.
	await expect(page.locator('#mode-bilete')).toBeChecked();
	await expect(page.locator('.capture input[type="file"]')).toBeVisible();
});
