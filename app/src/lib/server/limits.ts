import { error, type RequestEvent } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { RateLimiter, networkOf } from './rate-limit.ts';

/**
 * How often one visitor may do each thing that costs us something.
 *
 * Every number is set well above what a person does and well below what a script does. Somebody
 * sending in a week's worth of events from a poster wall does perhaps ten in an hour; somebody
 * scripting the form does ten a second. The second one is what these are for: each submission is
 * a model call and a row, each photo read a vision call, each writing-help press up to four, and
 * none of it is behind an account (ADR 0012) — so "who" has to mean "which address".
 *
 * The site-wide ceiling on model calls, which is what bounds the bill however many addresses a
 * caller has, is `modelBudget` in `verifier.ts`. These are per address, so one person cannot spend
 * everybody else's share of it.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const POLICIES = {
	/** Any POST at all — the floor under everything below, and under anything added later. */
	post: new RateLimiter(120, MINUTE),
	/** A submission: one verification (two model calls) and a stored row. */
	submit: new RateLimiter(15, HOUR),
	/** A pasted link: our server fetches a stranger's address, and may read it with a model. */
	link: new RateLimiter(30, HOUR),
	/** A poster read by the vision model. */
	photo: new RateLimiter(30, HOUR),
	/** A thumbnail crop, asked once after an approved submission. */
	crop: new RateLimiter(30, HOUR),
	/** Writing help: up to four model calls in a row. */
	writing: new RateLimiter(20, HOUR),
	/** An appeal: three jurors. One per submission is enforced elsewhere; this bounds the senders. */
	appeal: new RateLimiter(5, HOUR),
	/** A poster upload to public blob storage. */
	upload: new RateLimiter(20, HOUR),
	/** The nightly curation trigger. The cron calls it once; nobody else has a reason to. */
	kurator: new RateLimiter(3, HOUR),
	/** A question to the pile. Typing fires these, so the burst is generous. */
	ask: new RateLimiter(30, MINUTE),
	/** A heart toggled. A person taps; a script inflates a count. */
	heart: new RateLimiter(60, MINUTE),
	/** One more view. Counted per page open, so a person browsing quickly stays far below it. */
	view: new RateLimiter(60, MINUTE)
} satisfies Record<string, RateLimiter>;

export type Policy = keyof typeof POLICIES;

/**
 * Who is asking, as a rate-limit key.
 *
 * The address comes from `getClientAddress`, which in production reads the rightmost
 * `X-Forwarded-For` hop that Container Apps' own proxy appended (`ADDRESS_HEADER` and `XFF_DEPTH`
 * in infra/app.bicep). Without those it would be the proxy's address — one key for every visitor,
 * and the first busy evening would lock the whole town out.
 */
export function visitorKey(event: Pick<RequestEvent, 'getClientAddress'>): string {
	let address: string;
	try {
		address = event.getClientAddress();
	} catch {
		return 'unknown';
	}
	return networkOf(address);
}

/** Spend one of `policy` for this visitor. False when they have none left. */
export function allow(
	policy: Policy,
	event: Pick<RequestEvent, 'getClientAddress'> = getRequestEvent(),
	now = Date.now()
): boolean {
	const key = visitorKey(event);
	/*
	 * The machine itself is not a visitor. Loopback is the e2e suite and a developer's browser —
	 * which between them send more submissions in two minutes than a town does in a week — and it
	 * can never be a visitor in production, where the address is the one the proxy wrote. Exempting
	 * it here rather than by an environment flag means there is no switch that turns limits off.
	 */
	if (key === '127.0.0.1' || key === '0:0:0:0::/64') return true;
	return POLICIES[policy].take(key, now);
}

/** The same, as a 429 — for the endpoints whose callers already turn a status into a sentence. */
export function enforce(
	policy: Policy,
	event: Pick<RequestEvent, 'getClientAddress'> = getRequestEvent()
): void {
	if (!allow(policy, event)) error(429, TOO_MANY);
}

export const TOO_MANY =
	'Det kom veldig mange førespurnader frå deg på kort tid. Vent litt og prøv igjen.';
