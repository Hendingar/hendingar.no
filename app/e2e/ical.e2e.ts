import { expect, test } from '@playwright/test';

/**
 * The calendar download on an event page.
 *
 * The generator itself is unit-tested in @hendingar/core; what these cover is the part only a real
 * request can show — the headers, the route resolving from the slug, and the file being served as
 * something a calendar will accept rather than as text in a tab.
 */

async function firstEventPath(request: import('@playwright/test').APIRequestContext) {
	const html = await (await request.get('/hendingar')).text();
	const path = /href="(\/hending\/[^"]+)"/.exec(html)?.[1];
	expect(path, 'the listing should link to an event').toBeTruthy();
	return path!;
}

test('an event offers a calendar file with the right headers', async ({ request }) => {
	const path = await firstEventPath(request);
	const res = await request.get(`${path}/kalender.ics`);

	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toContain('text/calendar');
	// `attachment`, or every browser renders it as plain text in the tab instead of handing it to a
	// calendar.
	expect(res.headers()['content-disposition']).toMatch(/^attachment; filename=".+\.ics"$/);
});

test('the file is a valid single-event calendar', async ({ request }) => {
	const path = await firstEventPath(request);
	const body = await (await request.get(`${path}/kalender.ics`)).text();

	expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
	expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true);
	expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
	expect(body).toMatch(/DTSTART:\d{8}T\d{6}Z/);
	expect(body).toMatch(/UID:hending-\d+@hendingar\.no/);

	// CRLF everywhere. Some parsers drop everything after the first bare newline.
	expect(/[^\r]\n/.test(body)).toBe(false);
	// And no line over 75 octets, which is where multi-byte Norwegian letters bite.
	for (const line of body.split('\r\n')) {
		expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
	}
});

test('the event page links to it, as a real downloadable link', async ({ request }) => {
	const path = await firstEventPath(request);
	const html = await (await request.get(path)).text();
	// A link with `download`, not a script-driven blob: works with JavaScript off, opens in a new
	// tab, and long-presses on a phone.
	expect(html).toMatch(/<a[^>]+href="\/hending\/[^"]+\/kalender\.ics"[^>]*download/);
});

test('a stale slug still resolves, and a missing event does not', async ({ request }) => {
	const path = await firstEventPath(request);
	const id = /\/hending\/(\d+)/.exec(path)?.[1];

	// The id leads and is authoritative; the slug is decoration (see @hendingar/core/slug).
	const stale = await request.get(`/hending/${id}-heilt-feil-tittel/kalender.ics`);
	expect(stale.status()).toBe(200);
	expect(await stale.text()).toContain(`UID:hending-${id}@hendingar.no`);

	expect((await request.get('/hending/99999999/kalender.ics')).status()).toBe(404);
	expect((await request.get('/hending/ikkje-eit-tal/kalender.ics')).status()).toBe(404);
});
