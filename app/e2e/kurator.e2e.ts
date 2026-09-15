import { expect, test } from '@playwright/test';

/**
 * The weekend's picks (ADR 0018).
 *
 * `VERIFIER_URL` here is set but points at a closed port, so what these cover is the shape around
 * the selection rather than the selection: that the endpoint writes only on POST, that an
 * unreachable kurator leaves the page exactly as it was, and that a weekend with no stored picks
 * renders its listing without a gap where a section would be.
 *
 * What the two agents actually choose, and the rules that constrain them — no event that was not
 * offered, no three of one category, no reason nobody could verify — are tested where a model can
 * be made to answer on demand: services/verifier/tests/test_kurator.py.
 */

test('the curation degrades to nothing when the kurator cannot be reached', async ({
	request,
	baseURL
}) => {
	/*
	 * A 500 here would fail the nightly build over an optional section, and the ingest that runs
	 * alongside it imported fifteen sources perfectly. It answers, and says it did nothing.
	 */
	const response = await request.post('/api/kurator', { headers: { origin: baseURL ?? '' } });
	expect(response.status()).toBe(200);

	const body = await response.json();
	expect(body.picks).toBe(0);
	expect(body.note).toMatch(/ikkje tilgjengeleg|For få|ikkje slått på/);
	// Nothing was stored, so tomorrow's run is not blocked by today's failure.
	expect(body.fresh).toBe(false);
});

test('curating is a POST, because it writes', async ({ request }) => {
	// A GET that writes rows is one crawler away from running every hour.
	const response = await request.get('/api/kurator');
	expect(response.status()).toBe(405);
});

test('the trigger needs a matching origin, and the workflow sends one', async ({ request }) => {
	/*
	 * SvelteKit's CSRF check refuses a cross-origin POST, and a `curl -X POST` sends no `Origin`
	 * at all — so the nightly step has to set one, and this is why. Asserted rather than
	 * remembered: the header in `.github/workflows/ingest.yml` looks like clutter somebody would
	 * tidy away, and the symptom would be a nightly 403 nobody reads because the step is
	 * `continue-on-error`.
	 *
	 * Found by running the specs, not by reading the docs.
	 */
	const response = await request.post('/api/kurator', {
		headers: { origin: 'https://example.no' }
	});
	expect(response.status()).toBe(403);
});

test('a weekend with no picks is the listing, unchanged', async ({ page, request }) => {
	const html = await (await request.get('/denne-helga')).text();
	expect(html).not.toContain('Kuratoren si helg');

	await page.goto('/denne-helga');
	await expect(page.locator('.picks')).toHaveCount(0);
	// The page is the listing it always was — the picks are an addition, never a replacement.
	await expect(page.getByRole('heading', { name: 'Denne helga' })).toBeVisible();
});

test('next weekend is never curated', async ({ page }) => {
	/*
	 * The nightly run curates the weekend a reader is standing in or walking into, so there is
	 * nothing stored for `/neste-helg` and the component is not asked. Worth its own spec because
	 * both pages are one component, and a prop that stopped being read would show `/neste-helg`
	 * this weekend's picks above next weekend's listing.
	 */
	await page.goto('/neste-helg');
	await expect(page.locator('.picks')).toHaveCount(0);
});
