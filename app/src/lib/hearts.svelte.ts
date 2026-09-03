import { SvelteSet } from 'svelte/reactivity';

/**
 * What this browser has hearted, and the opaque id it uses to say so.
 *
 * Everything here is per-browser and stays in localStorage. There is no account: the id is a random
 * string the browser makes for itself the first time someone taps a heart, and it exists only so
 * the server can count browsers rather than taps. Clearing site data forgets everything, which is
 * the correct and intended behaviour rather than a limitation to work around.
 */

const IDS_KEY = 'hendingar:hearts';
const CLIENT_KEY = 'hendingar:client';

/**
 * Reactive, because the masthead shows a "Hjarta" item only once something is in here and has to
 * notice the moment the first heart lands. A plain `Set` is not reactive in Svelte 5 — the lint
 * rule `svelte/prefer-svelte-reactivity` exists for exactly this mistake.
 */
const ids = new SvelteSet<number>();

let clientId: string | null = null;
let loaded = false;

/**
 * Every read and write is wrapped.
 *
 * Storage throws rather than returning null in a Safari private window and wherever site data is
 * blocked. An events listing must not go blank because someone browses privately, so the failure
 * mode is "no hearts this session", never an error.
 */
function readStorage(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Ignored on purpose: hearting is a convenience, and a browser that refuses to remember is
		// not a browser we should show an error to.
	}
}

/** Reads localStorage once, on the client. Safe to call from an effect on every page. */
export function loadHearts(): void {
	if (loaded || typeof localStorage === 'undefined') return;
	loaded = true;

	const raw = readStorage(IDS_KEY);
	if (raw) {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				for (const value of parsed) {
					if (typeof value === 'number' && Number.isInteger(value) && value > 0) ids.add(value);
				}
			}
		} catch {
			// A corrupt value is not worth keeping, and definitely not worth crashing over.
		}
	}
	clientId = readStorage(CLIENT_KEY);
}

/**
 * This browser's id, minted on first use.
 *
 * Deliberately not created on page load: a reader who never hearts anything should never have an
 * identifier written for them at all.
 */
export function ensureClientId(): string {
	loadHearts();
	if (clientId) return clientId;
	const fresh =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
	clientId = fresh;
	writeStorage(CLIENT_KEY, fresh);
	return fresh;
}

export function isHearted(id: number): boolean {
	return ids.has(id);
}

/** Every hearted id, newest first is not knowable here — order is by id, ascending. */
export function heartedIds(): number[] {
	return [...ids];
}

export function heartedCount(): number {
	return ids.size;
}

function persist(): void {
	writeStorage(IDS_KEY, JSON.stringify([...ids]));
}

/** Adds locally and returns whether this was a change. The caller tells the server. */
export function rememberHeart(id: number): boolean {
	if (ids.has(id)) return false;
	ids.add(id);
	persist();
	return true;
}

/** Removes locally and returns whether this was a change. */
export function forgetHeart(id: number): boolean {
	if (!ids.delete(id)) return false;
	persist();
	return true;
}
