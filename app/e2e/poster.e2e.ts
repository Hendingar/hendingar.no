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
