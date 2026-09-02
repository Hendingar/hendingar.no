import { VERIFIER_URL } from '$app/env/private';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import { extractedEventSchema, type ExtractedEvent } from '@hendingar/core/validation';
import type { VerificationCheck, VerificationVerdict } from '@hendingar/core/verification';

/**
 * Client for the verifier microservice (services/verifier).
 *
 * The service runs on Azure Container Apps with internal-only ingress and authenticates to Azure
 * AI Foundry with its own managed identity — this app never holds a model credential. Every call
 * here degrades: if the service is unset, slow, or broken, the submission path still works and the
 * event goes to the human queue.
 */

export type CheckResult = {
	check: VerificationCheck;
	verdict: VerificationVerdict;
	confidence: number;
	reasoning: string;
	deterministic: boolean;
	model: string | null;
};

export type VerifyResponse = {
	checks: CheckResult[];
	recommendation: 'publish' | 'review' | 'reject';
	summary: string;
};

export function verifierEnabled(): boolean {
	return Boolean(VERIFIER_URL);
}

/** Extraction is interactive — a person is watching a spinner, so the budget is tight. */
const EXTRACT_TIMEOUT_MS = 45_000;
/** Verification happens on submit; the person is waiting on a confirmation. */
const VERIFY_TIMEOUT_MS = 30_000;

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
	if (!VERIFIER_URL) throw new Error('verifier is not configured');
	const res = await fetch(`${VERIFIER_URL.replace(/\/$/, '')}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`verifier ${path} responded ${res.status}: ${detail.slice(0, 200)}`);
	}
	return (await res.json()) as T;
}

/**
 * The service speaks snake_case (Python); our shared schema is camelCase. Translate and *validate*
 * at the boundary rather than trusting the response — a service returning a malformed date should
 * fail here, where the caller falls back to the manual form, not three layers deeper.
 */
export async function extractPoster(
	imageBase64: string,
	mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
	today: string
): Promise<ExtractedEvent> {
	const raw = await post<Record<string, unknown>>(
		'/extract',
		{ image_base64: imageBase64, media_type: mediaType, today },
		EXTRACT_TIMEOUT_MS
	);
	return extractedEventSchema.parse({
		title: raw.title,
		description: raw.description,
		category: raw.category,
		date: raw.date,
		startTime: raw.start_time,
		endTime: raw.end_time,
		recurrence: raw.recurrence,
		venueName: raw.venue_name,
		municipality: raw.municipality,
		organizerName: raw.organizer_name,
		ticketUrl: raw.ticket_url,
		confidence: raw.confidence,
		unreadable: raw.unreadable,
		note: raw.note
	});
}

export type VerifyInput = {
	title: string;
	description?: string | null;
	category: CategorySlug;
	startsAt: string;
	endsAt?: string | null;
	venueName?: string | null;
	municipality?: string | null;
	organizerName?: string | null;
	sourceUrl?: string | null;
	candidates: { id: number; title: string; startsAt: string; venueName: string | null }[];
};

/**
 * Never throws. A verifier that is down must not block a submission — the event is stored and
 * routed to a human, which is where an unverifiable event belongs anyway.
 */
export async function verifyEvent(input: VerifyInput): Promise<VerifyResponse> {
	/*
	 * The technical reason goes to the logs, never to the person submitting. "(fetch failed)" in
	 * the middle of a Nynorsk sentence tells a submitter nothing and reads as a broken site.
	 */
	const unavailable = (reason: string): VerifyResponse => {
		console.warn(`[verifier] unavailable: ${reason}`);
		return {
			checks: [
				{
					check: 'plausibility',
					verdict: 'uncertain',
					confidence: 0,
					reasoning:
						'Den automatiske kontrollen var ikkje tilgjengeleg då du sende inn, så hendinga går rett til manuell gjennomgang. Ho er lagra — ingenting er tapt.',
					deterministic: true,
					model: null
				}
			],
			recommendation: 'review',
			summary: 'Innsendinga ventar på manuell godkjenning.'
		};
	};

	if (!VERIFIER_URL) return unavailable('VERIFIER_URL is not set');

	try {
		return await post<VerifyResponse>(
			'/verify',
			{
				title: input.title,
				description: input.description ?? null,
				category: input.category,
				starts_at: input.startsAt,
				ends_at: input.endsAt ?? null,
				venue_name: input.venueName ?? null,
				municipality: input.municipality ?? null,
				organizer_name: input.organizerName ?? null,
				source_url: input.sourceUrl ?? null,
				candidates: input.candidates.map((c) => ({
					id: c.id,
					title: c.title,
					starts_at: c.startsAt,
					venue_name: c.venueName
				}))
			},
			VERIFY_TIMEOUT_MS
		);
	} catch (error) {
		return unavailable(error instanceof Error ? error.message : String(error));
	}
}
