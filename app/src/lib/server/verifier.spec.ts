import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({ VERIFIER_URL: 'http://verifier.test/' }));

const { improveDescriptionStreaming, judgeAppeal } = await import('./verifier.ts');

type Call = { url: string; body: unknown; accept: string | null };
const calls: Call[] = [];

function respond(body: BodyInit, contentType: string) {
	vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
		calls.push({
			url,
			body: JSON.parse(String(init.body)),
			accept: new Headers(init.headers).get('accept')
		});
		return new Response(body, { status: 200, headers: { 'content-type': contentType } });
	});
}

afterEach(() => {
	calls.length = 0;
	vi.unstubAllGlobals();
});

const submission = {
	title: 'Konsert',
	category: 'musikk' as const,
	startsAt: '2026-10-20T19:00',
	venueName: 'Kulturhuset'
};

/**
 * The service is Python and spells every field in snake_case. Three requests carry the same event,
 * built in one place — these pin what that place sends, so it cannot drift from the models in
 * services/verifier/src/verifier/models.py without a test noticing.
 */
describe('the event as the verifier reads it', () => {
	it('is sent in snake_case, every optional field explicitly null', async () => {
		respond(
			'event: suggestion\ndata: {"text": null, "note": "x", "missing": []}\n\n',
			'text/event-stream'
		);
		await improveDescriptionStreaming(submission).next();
		expect(calls[0]?.url).toBe('http://verifier.test/improve/stream');
		expect(calls[0]?.accept).toBe('text/event-stream');
		expect(calls[0]?.body).toEqual({
			title: 'Konsert',
			description: null,
			category: 'musikk',
			starts_at: '2026-10-20T19:00',
			ends_at: null,
			venue_name: 'Kulturhuset',
			municipality: null,
			organizer_name: null,
			source_url: null
		});
	});

	it('carries the appeal and the juror on top of the same event', async () => {
		respond(
			JSON.stringify({
				juror: 'a',
				name: 'A',
				publish: true,
				confidence: 80,
				reasoning: 'ok',
				model: 'm'
			}),
			'application/json'
		);
		await judgeAppeal({
			...submission,
			description: null,
			municipality: 'Stord',
			organizerName: null,
			sourceUrl: null,
			venueName: 'Kulturhuset',
			rejectionReason: 'utanfor',
			appeal: 'Det er på Stord.',
			juror: 'a'
		});
		expect(calls[0]?.url).toBe('http://verifier.test/appeal');
		expect(calls[0]?.body).toMatchObject({
			title: 'Konsert',
			starts_at: '2026-10-20T19:00',
			municipality: 'Stord',
			rejection_reason: 'utanfor',
			appeal: 'Det er på Stord.',
			juror: 'a'
		});
	});
});
