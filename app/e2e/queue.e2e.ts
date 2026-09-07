import { expect, test } from '@playwright/test';

/**
 * The queue, and the loop it exists to close.
 *
 * A submission that does not pass used to vanish: the sender saw a verdict once and had no way
 * back to it. `/ko` is that way back — their own submissions, why each one did or did not go out,
 * and a link to revise it.
 *
 * Per-browser, so each test's context is its own account without anyone logging in.
 */

async function submit(
	page: import('@playwright/test').Page,
	title: string,
	extra?: () => Promise<void>
) {
	await page.goto('/send-inn');
	await page.locator('#title').fill(title);
	await page.locator('#category').selectOption('festival');
	await page.locator('#date').fill('2027-05-19');
	await page.locator('#startTime').fill('11:00');
	await page.locator('#venueName').fill('Vinsen59');
	await extra?.();
	await page.getByRole('button', { name: /Send inn hendinga/ }).click();
	await page.waitForSelector('.verdict', { timeout: 20_000 });
}

test('an empty queue says so rather than showing an empty list', async ({ page }) => {
	await page.goto('/ko');
	await expect(page.getByText(/ikkje sendt inn noko/i)).toBeVisible();
	await expect(page.locator('.card')).toHaveCount(0);
});

test('a submission that did not pass appears in the queue, with the reason', async ({ page }) => {
	// The menu item is absent until there is something in it — an always-present, always-empty
	// item is a standing promise of a feature nobody has used.
	await page.goto('/send-inn');
	await expect(page.locator('nav a[href="/ko"]')).toHaveCount(0);

	await submit(page, 'Fiskefestival i Vinsen');
	await expect(page.locator('.verdict__head')).toHaveAttribute('data-outcome', 'declined');

	await page.goto('/ko');
	const card = page.locator('.card').first();
	await expect(card).toBeVisible();
	await expect(card).toContainText('Fiskefestival i Vinsen');

	// The point of the page: not that it failed, but why, and what to do.
	await expect(card.locator('.reasons li')).not.toHaveCount(0);
	await expect(card.locator('.card__fix')).not.toHaveText('');
	await expect(page.locator('nav a[href="/ko"]')).toBeVisible();
});

test('the revise link opens the form as a revision of that submission', async ({ page }) => {
	await submit(page, 'Fiskefestival i Vinsen');
	await page.goto('/ko');

	const href = await page.locator('.card__actions a').first().getAttribute('href');
	expect(href).toMatch(/^\/send-inn\?rett=\d+$/);

	await page.goto(href!);
	const id = /rett=(\d+)/.exec(href!)![1];
	// The id travels in the form, so the server knows which row to replace rather than adding one.
	await expect(page.locator('input[name*=revisionOf]')).toHaveValue(id!);
});

/*
 * Clicked, not `page.goto`-ed. That distinction is the whole reason this spec exists.
 *
 * Every other spec on this path navigates with `page.goto(href)`, which is a full page load — and
 * a full load is the one navigation that clears a remote form's result. So the bug below was
 * invisible to all of them: on a *client-side* navigation the result survives, so /send-inn
 * rendered the previous verdict where the form should be, and the form's own URL effect rewrote
 * the address bar to the receipt. Somebody asking to correct their event was handed back the
 * rejection they had just read, with no form anywhere on the page.
 */
test('following the revise link lands on a form, not on the verdict again', async ({ page }) => {
	await submit(page, 'Fiskefestival i Vinsen');

	// Client-side all the way: the nav link to the queue, then the queue's own revise link.
	await page.locator('nav a[href="/ko"]').first().click();
	await expect(page).toHaveURL(/\/ko$/);
	await page.locator('.card__actions a').first().click();

	await expect(page).toHaveURL(/\/send-inn\?rett=\d+$/);
	await expect(page.locator('#title')).toHaveValue('Fiskefestival i Vinsen', { timeout: 10_000 });
	await expect(page.locator('.verdict')).toHaveCount(0);
});

test('the form is usable again after a submission, without a reload', async ({ page }) => {
	// The same bug through its other door, and the worse one: the nav's own "Send inn" link left
	// the verdict on screen and no form at all, so a second event could not be sent.
	await submit(page, 'Fiskefestival i Vinsen');
	await page.locator('nav a[href="/send-inn"]').first().click();

	await expect(page.locator('.verdict')).toHaveCount(0);
	await expect(page.locator('#title')).toBeVisible();
	await expect(page.getByRole('button', { name: /Send inn hendinga/ })).toBeEnabled();

	/*
	 * Not asserted: that the fields are empty. They are not — a remote form's field values survive
	 * a client-side navigation the same way its result did, so this form opens holding the last
	 * submission. That is a separate wart and a separate decision (values surviving is what the
	 * revise path depends on, and misleading here), so it is named rather than quietly changed.
	 */
});

test('a revision says what stopped it, at the top and at the field', async ({ page }) => {
	/*
	 * A form that opens filled in still does not say what was wrong with it. The sender had to
	 * read the checks on the previous page, remember them, and guess which of eleven boxes they
	 * were about.
	 *
	 * The submission here gives no source URL, so `corroboration` is the check that does not pass
	 * — and `VERIFICATION_CHECK_FIELDS` in core says that check reads `sourceUrl`. The assertion
	 * is that the reason turns up beside *that* field, not merely somewhere on the page.
	 */
	await submit(page, 'Fiskefestival i Vinsen');
	await page.goto('/ko');
	const href = await page.locator('.card__actions a').first().getAttribute('href');
	await page.goto(href!);
	await expect(page.locator('#title')).toHaveValue('Fiskefestival i Vinsen', { timeout: 10_000 });

	const summary = page.locator('.form__fix');
	await expect(summary).toBeVisible();
	const listed = await summary.locator('.form__fix-list li').count();
	expect(listed).toBeGreaterThan(0);

	/*
	 * Which check fails is not asserted, deliberately.
	 *
	 * CI points VERIFIER_URL at a closed port, so every submission there takes the degraded path
	 * and the only check with anything to say is `plausibility` — while a developer with a real
	 * verifier gets `corroboration` for the missing source link. A spec naming either one passes
	 * in one place and fails in the other. What must hold in both is the mechanism: the failing
	 * checks are listed, and the fields *those* checks name carry the reason.
	 */
	const marked = page.locator('.field__fix');
	expect(await marked.count()).toBeGreaterThan(0);
	await expect(marked.first()).toContainText(/\S/);

	// Selective, not blanket: a form where every field shouts says nothing. `endTime` is named
	// only by `normalisation`, which passes on a draft whose date and time are well-formed.
	const endField = page.locator('.field', { has: page.locator('#endTime') });
	await expect(endField.locator('.field__fix')).toHaveCount(0);
});

test('a revision opens filled in, so nothing has to be retyped', async ({ page }) => {
	/*
	 * The bug this exists for. `?rett=` carried only the id: the server knew which row to replace
	 * and the fields knew nothing, so correcting one wrong date meant retyping the other ten. That
	 * is the kind of friction that makes people abandon the loop rather than use it.
	 */
	await submit(page, 'Fiskefestival i Vinsen');
	await page.goto('/ko');
	const href = await page.locator('.card__actions a').first().getAttribute('href');

	await page.goto(href!);
	await expect(page.locator('#title')).toHaveValue('Fiskefestival i Vinsen', { timeout: 10_000 });
	await expect(page.locator('#category')).toHaveValue('festival');
	await expect(page.locator('#venueName')).toHaveValue('Vinsen59');
	// The wall clock somebody typed, read back in the venue's zone rather than the server's — a
	// 20:00 concert returning as 18:00 would have them "correct" a time that was right.
	await expect(page.locator('#date')).toHaveValue('2027-05-19');
	await expect(page.locator('#startTime')).toHaveValue('11:00');
});

test('one browser cannot read back another’s draft', async ({ page, context }) => {
	await submit(page, 'Fiskefestival i Vinsen');
	await page.goto('/ko');
	const href = await page.locator('.card__actions a').first().getAttribute('href');

	// Same URL, different browser: the id is not a capability, the browser id is.
	const other = await context.browser()!.newContext();
	const stranger = await other.newPage();
	await stranger.goto(new URL(href!, page.url()).toString());
	await stranger.waitForTimeout(1500);
	await expect(stranger.locator('#title')).toHaveValue('');
	await other.close();
});

test('revising replaces the submission instead of stacking another draft', async ({ page }) => {
	/*
	 * The loop this closes. Without replacement each attempt leaves a near-identical row behind,
	 * and the second attempt is flagged as a duplicate of the first — so the queue fills up with
	 * drafts of one event that can never get out.
	 */
	await submit(page, 'Fiskefestival i Vinsen');
	await page.goto('/ko');
	await expect(page.locator('.card')).toHaveCount(1);

	const href = await page.locator('.card__actions a').first().getAttribute('href');
	await page.goto(href!);
	await page.locator('#title').fill('Fiskefestival i Vinsen');
	await page.locator('#category').selectOption('festival');
	await page.locator('#date').fill('2027-05-19');
	await page.locator('#startTime').fill('11:00');
	await page.locator('#venueName').fill('Vinsen59');
	await page.locator('#sourceUrl').fill('https://example.no/fiskefestival');
	await page.getByRole('button', { name: /Send inn hendinga/ }).click();
	await page.waitForSelector('.verdict', { timeout: 20_000 });

	await page.goto('/ko');
	await expect(page.locator('.card')).toHaveCount(1);
});

test('one browser never sees another browser’s submissions', async ({ page, context }) => {
	await submit(page, 'Fiskefestival i Vinsen');
	await page.goto('/ko');
	await expect(page.locator('.card')).toHaveCount(1);

	// No account, so the only thing scoping the queue is the browser's own opaque id.
	const other = await context.browser()!.newContext();
	const stranger = await other.newPage();
	await stranger.goto(new URL('/ko', page.url()).toString());
	await expect(stranger.getByText(/ikkje sendt inn noko/i)).toBeVisible();
	await expect(stranger.locator('.card')).toHaveCount(0);
	await other.close();
});

test('the queue is not offered to crawlers', async ({ request }) => {
	const html = await (await request.get('/ko')).text();
	expect(html).toMatch(/<meta name="robots" content="noindex"/);
});
