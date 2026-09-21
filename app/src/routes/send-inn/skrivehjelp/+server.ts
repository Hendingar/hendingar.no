import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { categorySchema } from '@hendingar/core/validation';
import { improveDescriptionStreaming, verifierEnabled } from '../../../lib/server/verifier';
import type { RequestHandler } from './$types';

/**
 * The writing help, streamed as the two agents take their turns.
 *
 * Server-sent events rather than a remote `command`, for the same reason the appeal panel is one:
 * this is up to four *sequential* model calls, and its ordinary answer is no text at all (ADR
 * 0017). As a single response that is ten to twenty seconds of nothing ending in a refusal — the
 * worst wait-to-answer ratio in the product, on the one feature whose whole claim is that the
 * reasoning is the thing being offered. Streamed, the refusal arrives as an argument somebody
 * watched happen.
 *
 * A POST, and that is deliberate rather than incidental: it keeps the property the `command` it
 * replaces had, which is that a crawler following a link cannot spend four model calls. `EventSource`
 * only speaks GET, so the client reads the body by hand — see `AppealPanel.svelte`, which does the
 * same.
 *
 * Nothing here writes anything, to the database or to the form. The browser is handed text to read
 * and a button that says what it does; that human accept in the middle is what makes generating
 * prose about somebody's event defensible at all.
 */

/** The same fields the form holds, unresolved: a wall clock, not an instant. */
const askSchema = z.object({
	title: z.string().trim().min(1).max(200),
	description: z.string().max(5000).nullish(),
	category: categorySchema,
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	startTime: z.string().regex(/^\d{2}:\d{2}$/),
	venueName: z.string().max(200).nullish(),
	municipality: z.string().max(200).nullish(),
	organizerName: z.string().max(200).nullish(),
	sourceUrl: z.string().max(2000).nullish()
});

function sse(event: string, data: unknown): Uint8Array {
	return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const POST: RequestHandler = async ({ request }) => {
	// Hidden rather than shown as a button that cannot work (CLAUDE.md rule 8) — but the route has
	// to say so too, because a button hidden in the page is not a route nobody can reach.
	if (!verifierEnabled()) error(503, 'Skrivehjelpa er ikkje slått på her.');

	const parsed = askSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Fyll inn tittel, kategori, dato og klokkeslett først.');

	const { date, startTime, ...rest } = parsed.data;

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				for await (const event of improveDescriptionStreaming({
					...rest,
					/*
					 * The sender's own wall clock, exactly as the two boxes hold it — not an instant.
					 * Nothing is stored from this call, and the time is in the record for one reason:
					 * so the fact-checker can tell a time the sender gave from one a draft invented.
					 */
					startsAt: `${date}T${startTime}`
				})) {
					if (event.kind === 'draft') controller.enqueue(sse('draft', event.draft));
					else if (event.kind === 'review') controller.enqueue(sse('review', event.review));
					else controller.enqueue(sse('suggestion', event.suggestion));
				}
			} catch {
				/*
				 * The headers left long ago, so there is no status to fail with — and there should
				 * not be one anyway. The person is looking at a form they filled in themselves, and
				 * the worst outcome this feature is allowed to have is that they keep their own
				 * words. The client turns this frame into exactly that sentence.
				 */
				controller.enqueue(sse('error', {}));
			}
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
