/**
 * Play something once, when it scrolls into view — and never hide it from anyone who will not.
 *
 * Shared by the drawn tiles (the match card, the trail card), which each animate in exactly once.
 * The rules are the ones that make that safe on a site whose server HTML is the product:
 *
 * - The server sends the finished card. Nothing is hidden until this has run and found the tile
 *   *below* the fold, so a crawler, a no-JS visitor and a tile already scrolled past see it whole.
 * - `armed` fires while the tile is still off screen (within `ARM_MARGIN` of it), which is when a
 *   caller sets up its first frame and starts any download it needs, so both are ready in time.
 * - `live` fires when enough of the tile is visible to see the thing happen.
 * - `settled` fires instead of both for a tile that will never animate: no IntersectionObserver,
 *   or already above the viewport (a restored scroll position, a back button).
 *
 * Returns the cleanup an `{@attach}` expects.
 */
export type RevealHandlers = {
	armed: () => void;
	live: () => void;
	settled: () => void;
};

/** How far below the fold a tile is armed. */
const ARM_MARGIN = '0px 0px 320px 0px';
/** How much of the tile has to be on screen before it plays. */
const LIVE_RATIO = 0.35;

export function revealOnce(node: Element, on: RevealHandlers): (() => void) | undefined {
	if (typeof IntersectionObserver === 'undefined' || node.getBoundingClientRect().bottom < 0) {
		on.settled();
		return undefined;
	}

	let armed = false;
	const near = new IntersectionObserver(
		(entries) => {
			if (!entries.some((e) => e.isIntersecting)) return;
			near.disconnect();
			armed = true;
			on.armed();
		},
		{ rootMargin: ARM_MARGIN }
	);
	const seen = new IntersectionObserver(
		(entries) => {
			if (!entries.some((e) => e.isIntersecting && e.intersectionRatio >= LIVE_RATIO)) return;
			seen.disconnect();
			near.disconnect();
			if (!armed) on.armed();
			on.live();
		},
		{ threshold: LIVE_RATIO }
	);
	near.observe(node);
	seen.observe(node);
	return () => {
		near.disconnect();
		seen.disconnect();
	};
}
