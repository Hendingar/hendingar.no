/**
 * A server-sent event stream: the transport for every long wait the person in front of the form
 * sits through — a poster being read, a description being drafted, a panel voting.
 *
 * `run` sends frames with `send` and the stream closes when it returns. A failure is not caught
 * here: by the time it happens the headers left long ago, so each route decides which frame — if
 * any — tells its own client what to do instead.
 */
export function eventStream(
	run: (send: (event: string, data: unknown) => void) => Promise<void>
): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			await run((event, data) =>
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
			);
			controller.close();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store',
			// A proxy that buffers holds the whole stream and delivers it at once, which is exactly
			// the experience a streaming endpoint exists to avoid.
			'x-accel-buffering': 'no',
			connection: 'keep-alive'
		}
	});
}
