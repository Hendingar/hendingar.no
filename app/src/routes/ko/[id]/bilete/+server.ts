import { error, json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { eventContributions, events } from '@hendingar/core/schema';
import { db } from '../../../../lib/server/db';
import {
	MAX_POSTER_BYTES,
	posterStorageEnabled,
	removePoster,
	storePoster
} from '../../../../lib/server/posters';
import type { RequestHandler } from './$types';

/**
 * Keep the picture a submission was sent with — on its own event, or on the one it improved.
 *
 * A second request, sent only after the verdict, which is the whole design. The image is not
 * attached to the submission, so an event that turns out to be `declined`, `shady` or a plain
 * duplicate never has its picture leave the browser at all. Nothing to delete afterwards, because
 * nothing was ever received.
 *
 * `[id]` is always the **submission**, and the row it writes to depends on what we concluded:
 *
 * - `approved` — the submission is the event. Its own `poster_url` is filled.
 * - `contributed` — the sender confirmed this is an event we already have, and that event has no
 *   poster. Their photograph fills that gap, and `event_contributions` records where it came from.
 *   This is the whole reason the outcome exists: an importer copies what a calendar publishes, and
 *   half those rows have no image, while the person who walked past the poster does.
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
	const [submission] = await database
		.select({
			id: events.id,
			status: events.status,
			outcome: events.submissionOutcome,
			posterUrl: events.posterUrl,
			duplicateOfId: events.duplicateOfId
		})
		.from(events)
		// Sent in from this browser. Nothing else is asked of the id — see the column comment in
		// schema.ts for what that id is and is not.
		.where(and(eq(events.id, id), eq(events.submitterClientId, clientId)))
		.limit(1);

	if (!submission) error(404, 'Fann ikkje innsendinga.');

	/*
	 * Which row gets the picture, and whether it may have one at all.
	 *
	 * Both branches require the destination's `poster_url` to be null. An unapproved submission
	 * keeps no image — that is the promise, and this is where it is kept — and a contribution fills
	 * a gap or does nothing, because nothing existing is ever replaced (see
	 * `@hendingar/core/contribution` for why gap-filling is what makes a browser-local id enough
	 * authority to do this at all).
	 */
	let targetId: number | null = null;
	let contributing = false;

	if (
		submission.status === 'published' &&
		submission.outcome === 'approved' &&
		submission.posterUrl === null
	) {
		targetId = submission.id;
	} else if (submission.outcome === 'contributed' && submission.duplicateOfId !== null) {
		const [canonical] = await database
			.select({ id: events.id })
			.from(events)
			.where(
				and(
					eq(events.id, submission.duplicateOfId),
					eq(events.status, 'published'),
					// Still canonical — a row since merged into another is not ours to write to.
					isNull(events.duplicateOfId),
					isNull(events.posterUrl)
				)
			)
			.limit(1);
		if (canonical) {
			targetId = canonical.id;
			contributing = true;
		}
	}

	if (targetId === null) {
		error(404, 'Fann ikkje ei hending som manglar bilete og kan få ditt.');
	}

	/*
	 * Named after the submission that supplied it, never after the row it lands on.
	 *
	 * For an approved submission those are the same id, so nothing changes there. For a
	 * contribution they are not, and naming the blob after the event would let two contributors
	 * racing on the same gap overwrite each other's bytes while the database pointed both at one
	 * URL. Named this way a blob is unique, is traceable to the row that owns it without a lookup
	 * table, and matches `event_contributions.submission_id`.
	 */
	const url = await storePoster(submission.id, body);

	/*
	 * The claim is taken in the WHERE clause, not in the check above.
	 *
	 * `poster_url is null` is re-asserted at the moment of writing, so two contributors uploading
	 * at once cannot both win: the second matches no row, learns it lost, and its blob is removed.
	 * A read-then-write would have let both through.
	 */
	const claimed = await database
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
		.where(and(eq(events.id, targetId), isNull(events.posterUrl)))
		.returning({ id: events.id });

	if (claimed.length === 0) {
		/*
		 * Somebody filled the gap between the check and the write. Their picture is on the event
		 * and ours is not needed, so it does not stay in the container — an unreferenced blob
		 * nobody can attribute is the thing that makes a bucket impossible to clean up.
		 */
		await removePoster(submission.id);
		return json({ posterUrl: null, reason: 'already-illustrated' }, { status: 409 });
	}

	if (contributing) {
		/*
		 * Where it came from, so it can be credited on the event and reverted from it.
		 *
		 * `onConflictDoNothing` against the one-offer-per-field index: a retried upload — a flaky
		 * connection, a reload — must not append a second `poster_url` row for the same submission.
		 */
		await database
			.insert(eventContributions)
			.values({
				eventId: targetId,
				submissionId: submission.id,
				clientId,
				field: 'posterUrl',
				value: url,
				applied: true
			})
			.onConflictDoNothing();
	}

	return json({ posterUrl: url });
};
