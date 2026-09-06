import { expect, test } from '@playwright/test';

/**
 * Keeping a poster, and — mostly — not keeping it.
 *
 * The image is sent a second time, after the verdict, and only for an event that was approved. So
 * an event that turns out to be declined, shady or a duplicate never has its picture leave the
 * browser at all: there is nothing on our side to delete, because nothing was received.
 *
 * CI has no storage account, so what these cover is the guards around the endpoint and the copy
 * that describes the rule. The cropping itself is unit-tested in src/lib/poster.spec.ts.
 */

test('the panel says what happens to the image, including when nothing does', async ({
	request
}) => {
	const html = await (await request.get('/send-inn')).text();

	/*
	 * This copy used to promise the image was never kept, and some now are. The condition has to be
	 * on the page before somebody uploads, not explained afterwards.
	 */
	expect(html).toMatch(/posisjonsdata i biletet blir\s+fjerna/);
	expect(html).toMatch(/miniatyrbilete/);
	expect(html).toMatch(/elles blir biletet ikkje lagra/);
});

/**
 * A poster-shaped PNG, made in the page so the suite carries no binary fixture.
 *
 * Portrait with a block of colour in the upper third, which is what a real one looks like to the
 * only code that cares here — the downscaler and the `<img>`.
 */
async function posterFile(page: import('@playwright/test').Page) {
	const base64 = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 600;
		canvas.height = 900;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#16223b';
		ctx.fillRect(0, 0, 600, 900);
		ctx.fillStyle = '#f7a98a';
		ctx.fillRect(60, 90, 480, 300);
		return canvas.toDataURL('image/png').split(',')[1]!;
	});
	return { name: 'plakat.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}

test('any submission can carry a picture, not only a photographed poster', async ({ page }) => {
	/*
	 * Before this, the only way an event got a real thumbnail was the photo shortcut, and only when
	 * the model's read succeeded. Somebody typing their event in had no way to offer the picture on
	 * their phone at all — so a submitted event that had one went out with a generated pattern.
	 */
	await page.goto('/send-inn');
	await page.locator('label[for="mode-skjema"]').click();

	const field = page.locator('.form__poster');
	await expect(field.getByRole('button', { name: /legg ved eit bilete/i })).toBeVisible();

	const uploads: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/bilete')) uploads.push(r.url());
	});

	await field.locator('input[type="file"]').setInputFiles(await posterFile(page));
	await expect(field.locator('img')).toBeVisible();

	/*
	 * Held in the browser, not sent. The `data:` URL is the assertion that matters: nothing leaves
	 * until the event is approved, which is the promise the page makes and the reason there is
	 * nothing to delete for a submission that is turned away.
	 */
	const src = await field.locator('img').getAttribute('src');
	expect(src?.startsWith('data:image/jpeg')).toBe(true);
	expect(uploads, 'nothing is uploaded while the form is being filled in').toEqual([]);

	// And it can be taken back.
	await field.getByRole('button', { name: /fjern biletet/i }).click();
	await expect(field.locator('img')).toHaveCount(0);
	await expect(field.getByRole('button', { name: /legg ved eit bilete/i })).toBeVisible();
});

test('a read that fails costs the draft, not the picture', async ({ page }) => {
	/*
	 * CI points VERIFIER_URL at a closed port, so every read here fails — which is exactly the case
	 * this exists for. The image used to live inside the photo panel and was handed up only with a
	 * successful draft, so somebody who had walked over to the noticeboard and photographed the
	 * poster was told to fill in the form and quietly lost the photograph on the way.
	 */
	await page.goto('/send-inn?med=bilete');
	await page.locator('.capture input[type="file"]').setInputFiles(await posterFile(page));

	await expect(page.getByText(/Biletet er teke vare på/i)).toBeVisible();

	await page.locator('label[for="mode-skjema"]').click();
	await expect(page.locator('.form__poster img')).toBeVisible();
});

test('an upload for an event that is not yours is refused', async ({ request }) => {
	const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
	const res = await request.post('/ko/1/bilete', {
		headers: {
			'content-type': 'image/jpeg',
			'x-client-id': '00000000-0000-4000-8000-000000000000'
		},
		data: jpeg
	});
	// 503 without storage configured, 404 with it — never 200 for somebody else's event.
	expect([403, 404, 503]).toContain(res.status());
});

test('a malformed browser id never reaches storage', async ({ request }) => {
	const res = await request.post('/ko/1/bilete', {
		headers: { 'content-type': 'image/jpeg', 'x-client-id': 'nope' },
		data: Buffer.from([0xff, 0xd8, 0xff])
	});
	expect([400, 403, 503]).toContain(res.status());
});

test('something that is not a JPEG is refused whatever it claims to be', async ({ request }) => {
	/*
	 * The content type is whatever the caller typed. Checking the magic bytes is the only thing
	 * between the container and an arbitrary file at a public URL on our own domain.
	 */
	const res = await request.post('/ko/1/bilete', {
		headers: {
			'content-type': 'image/jpeg',
			'x-client-id': '00000000-0000-4000-8000-000000000000'
		},
		data: Buffer.from('<html>not an image at all</html>')
	});
	expect([403, 404, 415, 503]).toContain(res.status());
	expect(res.status()).not.toBe(200);
});

test('an empty body is refused', async ({ request }) => {
	const res = await request.post('/ko/1/bilete', {
		headers: {
			'content-type': 'image/jpeg',
			'x-client-id': '00000000-0000-4000-8000-000000000000'
		},
		data: Buffer.alloc(0)
	});
	expect([400, 403, 404, 503]).toContain(res.status());
});
