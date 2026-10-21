import { redirect } from '@sveltejs/kit';

/**
 * `/poppis` is not a third listing — it is whichever ordering we show first.
 *
 * A redirect rather than a duplicate page, so there is exactly one URL per ordering and no third
 * thing to keep in step.
 *
 * Opens lead. Hearts led first, because a heart is a deliberate act and an open may only mean the
 * title was intriguing — but almost nobody hearts, so the page people landed on was a list ordered
 * by nothing. An ordering made of a signal that exists beats a better one that does not.
 *
 * 307, not 308: which ordering leads is an editorial decision, and a permanent redirect would sit
 * in caches long after we changed our minds about it.
 */
export function load() {
	redirect(307, '/poppis/vist');
}
