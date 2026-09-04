/**
 * This browser's opaque id, and the guarded storage access around it.
 *
 * Shared by two features that have nothing to do with each other — hearts, so a count counts
 * browsers rather than taps; submissions, so somebody can find their own in /kø and revise it.
 * It lived in `hearts.svelte.ts` first, which made the submission form import "hearts" to learn
 * who it was talking to.
 *
 * It is not an account. No name, no email, nothing derived from the device, and nothing that
 * survives clearing site data. Where it guards anything — revising an unpublished submission — it
 * is a 122-bit random value acting as a bearer token, which is proportionate to what is at stake
 * and must never gate anything that matters more.
 */

const CLIENT_KEY = 'hendingar:client';

/**
 * Every read and write is wrapped.
 *
 * Storage throws rather than returning null in a Safari private window and wherever site data is
 * blocked. A listing must not go blank because somebody browses privately, so the failure mode is
 * "no memory this session", never an error.
 */
export function readStorage(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function writeStorage(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Ignored on purpose: a browser that refuses to remember is not one to show an error to.
	}
}

let cached: string | null = null;

/**
 * Minted on first use, never on page load.
 *
 * Somebody who only reads should never have an identifier written for them. This is called when
 * they heart something or send something in — the two moments they have asked to be remembered.
 */
export function ensureClientId(): string {
	if (cached) return cached;
	if (typeof localStorage === 'undefined') return '';

	const existing = readStorage(CLIENT_KEY);
	if (existing) {
		cached = existing;
		return existing;
	}

	const fresh =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
	cached = fresh;
	writeStorage(CLIENT_KEY, fresh);
	return fresh;
}

/** The id if this browser already has one, without minting. */
export function existingClientId(): string | null {
	if (cached) return cached;
	if (typeof localStorage === 'undefined') return null;
	cached = readStorage(CLIENT_KEY);
	return cached;
}
