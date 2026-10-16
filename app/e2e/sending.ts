import { expect, type Page } from '@playwright/test';

/**
 * Press send on /send-inn — but only once the form carries a sender id.
 *
 * The id is minted by script, so a form sent before hydration is posted by the browser with an
 * empty one, and the submission lands with no sender: the no-JavaScript outcome SubmitForm
 * documents at `claimIdentity`. That is right for a person without JavaScript and wrong for any
 * spec that later finds the submission by browser — `/ko`, a reloaded receipt. Playwright types
 * and clicks the moment the page loads, so on a loaded runner it sometimes clicked first, and the
 * spec then waited for something that could never appear. It failed `main` twice that way, and a
 * longer timeout was tried once and could not help.
 */
export async function sendOnceIdentified(page: Page) {
	await expect(page.locator('input[name^="clientId/"]')).not.toHaveValue('');
	await page.getByRole('button', { name: /Send inn hendinga/ }).click();
}

/**
 * A submission the checks decline — no municipality, a place nobody can find — with its verdict
 * on screen. Shared by the queue and appeal specs, which both need one in `/ko`.
 */
export async function submitDeclined(page: Page, title: string, extra?: () => Promise<void>) {
	await page.goto('/send-inn');
	await page.locator('#title').fill(title);
	await page.locator('#category').selectOption('festival');
	await page.locator('#date').fill('2027-05-19');
	await page.locator('#startTime').fill('11:00');
	await page.locator('#venueName').fill('Vinsen59');
	await extra?.();
	await sendOnceIdentified(page);
	await page.waitForSelector('.verdict', { timeout: 20_000 });
}
