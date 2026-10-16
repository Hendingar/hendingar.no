import { expect, type Page } from '@playwright/test';

/**
 * Send /send-inn a submission the checks decline — no municipality, a place nobody can find — and
 * wait for the verdict. Shared by the queue and appeal specs, which both need one in `/ko`.
 *
 * It waits for the form to carry a sender id before it clicks. The id is minted by script, so a
 * form sent before hydration is posted by the browser with an empty one, and the submission lands
 * with no sender — the no-JavaScript outcome SubmitForm documents at `claimIdentity`. That is right
 * for a person without JavaScript and wrong for a test of `/ko`: under CI load Playwright could
 * click first, and the spec then waited for a card that could never come. It failed `main` once.
 */
export async function submitDeclined(page: Page, title: string, extra?: () => Promise<void>) {
	await page.goto('/send-inn');
	await page.locator('#title').fill(title);
	await page.locator('#category').selectOption('festival');
	await page.locator('#date').fill('2027-05-19');
	await page.locator('#startTime').fill('11:00');
	await page.locator('#venueName').fill('Vinsen59');
	await extra?.();
	await expect(page.locator('input[name^="clientId/"]')).not.toHaveValue('');
	await page.getByRole('button', { name: /Send inn hendinga/ }).click();
	await page.waitForSelector('.verdict', { timeout: 20_000 });
}
