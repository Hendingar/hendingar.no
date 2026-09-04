import { expect, test } from '@playwright/test';

/**
 * The appeal.
 *
 * The automatic checks answer "does this parse". Whether somebody is telling the truth about a real
 * event in their town is a judgement, and ADR 0012 named the absence of a reply to a wrong "nei" as
 * its sharpest edge. This is the reply: three jurors, two must agree, streamed as they land.
 *
 * CI has no verifier, so what these cover is everything around the panel — the guards, the bounds,
 * and that its absence degrades to a message rather than a hang. The panel's own behaviour is
 * unit-tested in services/verifier (tests/test_appeal.py) against a stubbed client.
 */

async function declinedSubmission(page: import('@playwright/test').Page) {
	await page.goto('/send-inn');
	await page.locator('#title').fill('Fiskefestival i Vinsen');
	await page.locator('#category').selectOption('festival');
	await page.locator('#date').fill('2027-05-19');
	await page.locator('#startTime').fill('11:00');
	await page.locator('#venueName').fill('Vinsen59');
	await page.getByRole('button', { name: /Send inn hendinga/ }).click();
	await page.waitForSelector('.verdict', { timeout: 20_000 });
	await page.goto('/ko');
	await page.waitForSelector('.card', { timeout: 8000 });
}

test('a declined submission offers a way to argue, not only a way to edit', async ({ page }) => {
	await declinedSubmission(page);

	// Two different remedies. Revising is for something that is wrong; the appeal is for when
	// nothing is wrong and the checks are — you cannot fix that by editing a field.
	await expect(page.getByRole('link', { name: /Rett og send inn på nytt/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Legg fram saka di/ })).toBeVisible();
});

test('the case has to say something before it can be sent', async ({ page }) => {
	await declinedSubmission(page);
	await page.getByRole('button', { name: /Legg fram saka di/ }).click();

	const send = page.getByRole('button', { name: /^Legg fram saka$/ });
	await expect(send).toBeDisabled();

	// Bounded in the browser, in the endpoint and in the service — it reaches a model.
	await page.locator('textarea').fill('kort');
	await expect(send).toBeDisabled();
	await page
		.locator('textarea')
		.fill('Eg tok bilete av plakaten på butikken, og båtforeininga arrangerer.');
	await expect(send).toBeEnabled();
});

test('a missing panel is a message, never a hang', async ({ page }) => {
	/*
	 * The verifier is unreachable in CI, which is the same shape as it being down in production.
	 * The one thing that must not happen is a spinner that never resolves.
	 */
	await declinedSubmission(page);
	await page.getByRole('button', { name: /Legg fram saka di/ }).click();
	await page
		.locator('textarea')
		.fill('Eg tok bilete av plakaten på butikken, og båtforeininga arrangerer.');
	await page.getByRole('button', { name: /^Legg fram saka$/ }).click();

	await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByRole('button', { name: /^Legg fram saka$/ })).toBeEnabled();
});

test('an appeal on somebody else’s submission is refused', async ({ page, request }) => {
	await declinedSubmission(page);
	const href = await page.locator('.card__actions a').first().getAttribute('href');
	const id = /rett=(\d+)/.exec(href!)![1];

	// A different browser id: the row is not theirs, so there is nothing to appeal.
	const res = await request.post(`/ko/${id}/appell`, {
		data: {
			clientId: '00000000-0000-4000-8000-000000000000',
			appeal: 'Eg meiner denne hendinga er ekte og bør leggjast ut på sida.'
		}
	});
	expect([403, 404, 503]).toContain(res.status());
});

test('a malformed browser id is refused outright', async ({ request }) => {
	const res = await request.post('/ko/1/appell', {
		data: { clientId: 'nope', appeal: 'Denne hendinga er ekte og bør leggjast ut på sida.' }
	});
	expect([400, 403, 503]).toContain(res.status());
});

test('an empty case never reaches the panel', async ({ request }) => {
	const res = await request.post('/ko/1/appell', {
		data: { clientId: '00000000-0000-4000-8000-000000000000', appeal: 'kort' }
	});
	expect([400, 403, 404, 503]).toContain(res.status());
});
