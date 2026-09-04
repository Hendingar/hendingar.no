import { error } from '@sveltejs/kit';
import { and, eq, gte, isNotNull, isNull, ne } from 'drizzle-orm';
import { events, venues } from '@hendingar/core/schema';
import { submissionCutoff } from '@hendingar/core/submissions';
import { db } from '../../../../lib/server/db';
import {
	appealPanel,
	judgeAppeal,
	verifierEnabled,
	type JurorVerdict
} from '../../../../lib/server/verifier';
import type { RequestHandler } from './$types';

/**
 * An appeal, streamed as the panel votes.
 *
 * Server-sent events rather than a remote function, because the whole point is that the reader
 * watches three opinions arrive one at a time. A request/response call would make them stare at a
 * spinner for the length of the slowest juror and then dump everything at once — which is the
 * experience this replaces, not an acceptable version of it.
 *
 * The three jurors are asked concurrently and each is written out the moment it lands, so the order
 * on screen is the order they finished rather than the order they were asked.
 */

/** Bounded here as well as in the service: this text reaches a model. */
const MIN_APPEAL = 10;
const MAX_APPEAL = 2000;

function sse(event: string, data: unknown): Uint8Array {
	return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const POST: RequestHandler = async ({ params, request }) => {
	if (!verifierEnabled()) error(503, 'Appellpanelet er ikkje tilgjengeleg i dette miljøet.');

	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0) error(404, 'Fann ikkje innsendinga');

	const body: unknown = await request.json();
	const clientId =
		typeof body === 'object' && body !== null ? (body as Record<string, unknown>).clientId : null;
	const appeal =
		typeof body === 'object' && body !== null ? (body as Record<string, unknown>).appeal : null;

	if (typeof clientId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(clientId)) {
		error(403, 'Denne innsendinga er ikkje di.');
	}
	if (typeof appeal !== 'string' || appeal.trim().length < MIN_APPEAL) {
		error(400, `Skriv litt meir — minst ${MIN_APPEAL} teikn.`);
	}
	if (appeal.length > MAX_APPEAL) error(400, 'Det blei for langt.');

	const database = db();
	const [row] = await database
		.select({
			id: events.id,
			title: events.title,
			description: events.description,
			category: events.category,
			startsAt: events.startsAt,
			sourceUrl: events.sourceUrl,
			notes: events.verificationNotes,
			outcome: events.submissionOutcome,
			appealedAt: events.appealedAt,
			venueName: venues.name,
			venueMunicipality: venues.municipality
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(
			and(
				eq(events.id, id),
				// Yours, and only yours.
				eq(events.submitterClientId, clientId),
				// Never a published event: an appeal is a way onto the site, not a way to edit it.
				ne(events.status, 'published'),
				// A decided submission, not an import.
				isNotNull(events.submissionOutcome),
				// One appeal per submission. Without this the panel is a retry button, and a
				// retry button on a model is a way to roll dice until you win.
				isNull(events.appealedAt),
				// Still inside its two days. An expired submission is gone as far as /kø is
				// concerned, and appealing something the next sweep deletes helps nobody.
				gte(events.updatedAt, submissionCutoff())
			)
		)
		.limit(1);

	if (!row) error(404, 'Fann ikkje ei innsending du kan appellere.');

	const { jurors, quorum } = await appealPanel();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			controller.enqueue(sse('panel', { jurors, quorum }));

			const input = {
				title: row.title,
				description: row.description,
				category: row.category,
				startsAt: row.startsAt.toISOString(),
				venueName: row.venueName,
				municipality: row.venueMunicipality,
				organizerName: null,
				sourceUrl: row.sourceUrl,
				rejectionReason: row.notes,
				appeal: appeal.trim()
			};

			const verdicts: JurorVerdict[] = [];

			/*
			 * All three at once, each written out as it lands.
			 *
			 * `Promise.all` would work and would show nothing until the slowest one finished, which
			 * defeats the point. `judgeAppeal` never throws for a juror-level problem — the service
			 * turns that into a no vote with a reason — so a rejection here is a transport failure
			 * and is reported as one rather than silently counting as a vote against.
			 */
			await Promise.all(
				jurors.map(async (juror) => {
					try {
						const verdict = await judgeAppeal({ ...input, juror: juror.id });
						verdicts.push(verdict);
						controller.enqueue(sse('verdict', verdict));
					} catch {
						const failed: JurorVerdict = {
							juror: juror.id,
							name: juror.name,
							publish: false,
							confidence: 0,
							reasoning: 'Denne juroren svarte ikkje.',
							model: null
						};
						verdicts.push(failed);
						controller.enqueue(sse('verdict', failed));
					}
				})
			);

			const forPublishing = verdicts.filter((v) => v.publish).length;
			const passed = forPublishing >= quorum;

			/*
			 * Written before the decision is announced.
			 *
			 * If the connection drops between the last verdict and the client acting on it, the
			 * database still holds the outcome — the alternative is a panel that sat, decided, and
			 * left no trace, which the sender would experience as their appeal vanishing.
			 */
			await database
				.update(events)
				.set({
					appealText: appeal.trim(),
					appealedAt: new Date(),
					appealVerdicts: JSON.stringify(verdicts),
					...(passed
						? {
								status: 'published' as const,
								submissionOutcome: 'approved' as const,
								verificationNotes: `Publisert etter appell: ${forPublishing} av ${jurors.length} jurorar sa ja.`
							}
						: {}),
					updatedAt: new Date()
				})
				.where(eq(events.id, row.id));

			controller.enqueue(
				sse('decision', {
					passed,
					forPublishing,
					of: jurors.length,
					quorum,
					eventId: row.id
				})
			);
			controller.close();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store',
			// Proxies that buffer will hold the whole stream and deliver it at once, which is
			// exactly the experience this endpoint exists to avoid.
			'x-accel-buffering': 'no',
			connection: 'keep-alive'
		}
	});
};
