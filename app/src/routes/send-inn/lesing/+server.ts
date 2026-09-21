import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { extractPosterStreaming, verifierEnabled } from '../../../lib/server/verifier';
import type { RequestHandler } from './$types';

/**
 * A poster being read, streamed as the model writes it.
 *
 * This is the longest single wait on the site — one vision call, five to fifteen seconds — and the
 * panel in front of it could say nothing true about what was happening. So it narrated: "Les tittel
 * og dato…" appeared three seconds in whether or not that had happened, and a bar crept along an
 * elapsed-time curve. Honest about being a guess, and still a guess.
 *
 * A strict-schema answer is emitted in schema order, so the title is finished and correct while the
 * organiser does not yet exist. There was a real answer to show the whole time.
 *
 * A POST rather than a GET for the reason the `command` it sits beside is one: this spends a vision
 * call, and a crawler following a link must not be able to trigger it. `EventSource` only speaks
 * GET, so the browser reads the body by hand — as `AppealPanel.svelte` and `DescriptionHelp.svelte`
 * both do.
 *
 * Nothing is stored. The image is read once and never written down; what comes back pre-fills a
 * form a person checks before anything is sent, which is the review step that makes reading
 * somebody's poster with a model defensible at all.
 */

/** 8 MB of base64 ≈ 6 MB of image. The browser downscales first; this is the backstop. */
const MAX_IMAGE_BASE64 = 8_000_000;

const readSchema = z.object({
	imageBase64: z.string().min(100).max(MAX_IMAGE_BASE64),
	mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
	/** The photographer's local date, so "laurdag 14." resolves to the right year. */
	today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

function sse(event: string, data: unknown): Uint8Array {
	return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const POST: RequestHandler = async ({ request }) => {
	// Hidden rather than offered as a button that cannot work (CLAUDE.md rule 8) — and the route
	// says so too, because a control hidden in a page is not a route nobody can reach.
	if (!verifierEnabled()) error(503, 'Bilettolking er ikkje slått på her.');

	const parsed = readSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Biletet kunne ikkje lesast. Fyll inn skjemaet under.');

	const { imageBase64, mediaType, today } = parsed.data;

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				for await (const event of extractPosterStreaming(imageBase64, mediaType, today)) {
					if (event.kind === 'field') controller.enqueue(sse('field', event.field));
					else controller.enqueue(sse('event', event.event));
				}
			} catch {
				/*
				 * The headers left long ago, so there is no status to fail with — and a failed read
				 * was never a failed submission anyway. The browser turns this into the sentence it
				 * already had: fill in the form yourself, and the picture you chose is still held.
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
			// A proxy that buffers holds the whole stream and delivers it at once, which is exactly
			// the experience this endpoint exists to avoid.
			'x-accel-buffering': 'no',
			connection: 'keep-alive'
		}
	});
};
