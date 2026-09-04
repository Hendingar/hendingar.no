import { error, json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { events } from '@hendingar/core/schema';
import { db } from '../../../../lib/server/db';
import {
	MAX_POSTER_BYTES,
	posterStorageEnabled,
	storePoster
} from '../../../../lib/server/posters';
import type { RequestHandler } from './$types';

/**
 * Keep the poster for an event that was approved.
 *
 * A second request, sent only after the verdict — which is the whole design. The image is not
 * attached to the submission, so an event that turns out to be `declined`, `shady` or a duplicate
 * never has its picture leave the browser at all. Nothing to delete afterwards, because nothing
 * was ever received.
 *
 * The browser sends a cropped, re-encoded JPEG. The crop box comes from the model that read the
 * poster; cropping there rather than here keeps image processing out of the server entirely.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!posterStorageEnabled()) error(503, 'Biletlagring er ikkje slått på i dette miljøet.');

	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0) error(404, 'Fann ikkje hendinga');

	const clientId = request.headers.get('x-client-id');
	if (!clientId || !/^[A-Za-z0-9-]{8,64}$/.test(clientId)) {
		error(403, 'Denne hendinga er ikkje di.');
	}

	const body = new Uint8Array(await request.arrayBuffer());
	if (body.byteLength === 0) error(400, 'Tomt bilete.');
	if (body.byteLength > MAX_POSTER_BYTES) error(413, 'Biletet er for stort.');
	/*
	 * A JPEG, checked by its own first bytes rather than by what the request claims.
	 *
	 * `content-type` is whatever the caller typed. This is the only thing standing between the
	 * container and somebody storing an arbitrary file at a public URL on our domain.
	 */
	if (!(body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff)) {
		error(415, 'Biletet må vere ein JPEG.');
	}

	const database = db();
	const [row] = await database
		.select({ id: events.id })
		.from(events)
		.where(
			and(
				eq(events.id, id),
				// Sent in from this browser, and published. An unapproved event keeps no picture —
				// that is the promise, and this is where it is kept.
				eq(events.submitterClientId, clientId),
				eq(events.status, 'published'),
				eq(events.submissionOutcome, 'approved'),
				// Once only. Without this the endpoint is a way to replace the image on a live
				// listing at any later date.
				isNull(events.posterUrl)
			)
		)
		.limit(1);

	if (!row) error(404, 'Fann ikkje ei godkjend hending som manglar bilete.');

	const url = await storePoster(row.id, body);

	await database
		.update(events)
		.set({
			posterUrl: url,
			/*
			 * Rights are verified in the only sense that matters here: the person who took the
			 * photograph chose to send it to us for this purpose. That is a stronger claim than we
			 * can make about any hotlinked poster from an importer.
			 */
			posterRightsVerified: true,
			updatedAt: new Date()
		})
		.where(eq(events.id, row.id));

	return json({ posterUrl: url });
};
