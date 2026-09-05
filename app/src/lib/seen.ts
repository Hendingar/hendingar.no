import { readStorage, writeStorage } from './client-id.ts';

/**
 * Which events this browser has already been counted for.
 *
 * The dedupe for the view counter lives here, in the browser, rather than as a row per reader on
 * the server — see the `eventViews` comment in `packages/core/src/schema.ts` for why. The server
 * is told "count one more" and never which browser said so, so this list is the only thing that
 * stops a reload counting twice, and it never leaves the device.
 *
 * Storage may throw or be empty (a private window, cleared site data). That degrades to counting
 * a view again on the next visit, which is the harmless direction to fail in — the alternative
 * would be losing counts entirely.
 */

const SEEN_KEY = 'hendingar:seen';

/** A cap, so a heavy reader's list cannot grow without bound in a five-megabyte store. */
const MAX_REMEMBERED = 500;

function read(): number[] {
	const raw = readStorage(SEEN_KEY);
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		// Anything that is not a list of ids is treated as absent rather than repaired.
		return Array.isArray(parsed)
			? parsed.filter((id): id is number => Number.isSafeInteger(id))
			: [];
	} catch {
		return [];
	}
}

/**
 * Record that this browser has now seen `eventId`, and say whether that was new.
 *
 * The caller only reports a view when this returns true. Writing before the request rather than
 * after is deliberate: a failed report costs one uncounted view, while reporting first and writing
 * after would double-count every time the request is slow enough for the reader to reload.
 */
export function markSeen(eventId: number): boolean {
	const seen = read();
	if (seen.includes(eventId)) return false;

	// Oldest first, so the cap drops what was read longest ago.
	const next = [...seen, eventId].slice(-MAX_REMEMBERED);
	writeStorage(SEEN_KEY, JSON.stringify(next));
	return true;
}
