<script lang="ts">
	/**
	 * The thumbnail.
	 *
	 * Uses the real poster when we have one — and we only ever have one when the source says the
	 * image rights are verified. As of writing, `detskjer.sunnhordland.no` returns a poster URL for
	 * every event and `imageRightsVerified: false` for all of them, so in practice every tile here
	 * is generated.
	 *
	 * That is not a placeholder-shaped apology. A generated duotone tile is deterministic (same
	 * event, same pattern, forever), costs no bytes, never 404s when a third party reorganises
	 * their CDN, and looks like the rest of the site rather than like someone else's JPEG.
	 */
	let {
		id,
		posterUrl = null,
		posterSrcset = null,
		title
	}: {
		id: number;
		posterUrl?: string | null;
		/**
		 * The same poster at every size its source will serve, as an `<img srcset>` candidate list.
		 * Null for a source that offers one size — the tile then renders a plain `src`.
		 */
		posterSrcset?: string | null;
		title: string;
	} = $props();

	// Deterministic per event: no Math.random, so a tile never changes between server and client
	// render, and a screenshot test stays stable.
	const variant = $derived(id % 4);
	const rotation = $derived((id % 7) * 13);

	// Posters are hotlinked from the source's CDN. A third party can reorganise or remove a file at
	// any time, so a broken image must degrade to the generated tile rather than to a broken icon.
	let posterFailed = $state(false);
	const showPoster = $derived(Boolean(posterUrl) && !posterFailed);

	/**
	 * How wide this thumbnail actually is, per breakpoint. **Measured, not guessed.**
	 *
	 * Without a `sizes`, a `srcset` of width candidates is assumed to be `100vw` and the browser
	 * takes the largest file every time — the tile is nowhere near the width of the window, so that
	 * would trade one wrong resolution for another and cost the bytes as well.
	 *
	 * The shell is `min(88rem, 100vw)` with `padding-inline: clamp(1.25rem, 4vw, 4rem)`, and
	 * EventsByDay's grid steps 1 → 2 → 3 → 4 columns at 34rem, 60rem and 80rem with
	 * `gap: clamp(0.75rem, 1.5vw, 1.25rem)`. Working the column width out at each step:
	 *
	 * | viewport | layout            | tile image | ×2 display |
	 * | -------- | ----------------- | ---------- | ---------- |
	 * | 320–543  | row, fixed 5.5rem | **88px**   | 176px      |
	 * | 544      | 2 columns         | 244px      | 488px      |
	 * | 959      | 2 columns         | **434px**  | **868px**  |
	 * | 960      | 3 columns         | 285px      | 570px      |
	 * | 1279     | 3 columns         | **379px**  | 758px      |
	 * | 1280     | 4 columns         | 280px      | 560px      |
	 * | ≥1408    | 4 columns, capped | **309px**  | 618px      |
	 *
	 * So 434 CSS pixels is the widest a card image is ever painted, anywhere — 868 device pixels on
	 * the 2× screen most phones and laptops have. Below 34rem the tile is a row with a fixed 5.5rem
	 * square, which is why a phone must NOT be sent the same file as a laptop: at 88px it needs a
	 * twentieth of the pixels.
	 *
	 * Each entry rounds slightly up (48vw against a measured 46, 30vw against 29.7) so the browser
	 * never picks a candidate too small for the slot, and covers the 3% the hover transform adds.
	 * The breakpoints are the same numbers as EventTile's and EventsByDay's media queries: if one
	 * moves, this moves.
	 */
	const SIZES = '(width < 34rem) 5.5rem, (width < 60rem) 48vw, (width < 80rem) 30vw, 310px';
</script>

{#if showPoster}
	<img
		class="thumb"
		src={posterUrl}
		srcset={posterSrcset}
		sizes={posterSrcset ? SIZES : undefined}
		alt=""
		loading="lazy"
		decoding="async"
		width="400"
		height="225"
		referrerpolicy="no-referrer"
		onerror={() => (posterFailed = true)}
	/>
{:else}
	<div class="thumb thumb--generated" role="img" aria-label={`Illustrasjon for ${title}`}>
		<svg viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
			<defs>
				<pattern id={`t-dots-${id}`} width="9" height="9" patternUnits="userSpaceOnUse">
					<circle cx="2.2" cy="2.2" r="1.7" fill="var(--peach)" />
				</pattern>
				<radialGradient id={`t-fade-${id}`} cx="50%" cy="48%" r="66%">
					<stop offset="0%" stop-color="#fff" stop-opacity="0.95" />
					<stop offset="100%" stop-color="#fff" stop-opacity="0.05" />
				</radialGradient>
				<mask id={`t-mask-${id}`}>
					<rect width="400" height="225" fill={`url(#t-fade-${id})`} />
				</mask>
			</defs>

			<rect width="400" height="225" fill="var(--navy-900)" />
			<rect width="400" height="225" fill={`url(#t-dots-${id})`} mask={`url(#t-mask-${id})`} />

			<g
				fill="none"
				stroke="var(--peach)"
				stroke-width="2"
				transform={`rotate(${rotation} 200 112)`}
				opacity="0.75"
			>
				{#if variant === 0}
					<circle cx="200" cy="112" r="46" />
					<circle cx="200" cy="112" r="78" stroke-opacity="0.5" />
				{:else if variant === 1}
					<rect x="140" y="52" width="120" height="120" />
					<rect x="166" y="78" width="68" height="68" stroke-opacity="0.5" />
				{:else if variant === 2}
					<ellipse cx="200" cy="112" rx="104" ry="52" />
					<ellipse cx="200" cy="112" rx="52" ry="94" stroke-opacity="0.5" />
				{:else}
					<path d="M132 168 L200 56 L268 168 Z" />
					<path d="M160 152 L200 88 L240 152 Z" stroke-opacity="0.5" />
				{/if}
			</g>
		</svg>
	</div>
{/if}

<style>
	.thumb {
		display: block;
		inline-size: 100%;
		block-size: auto;
		/* 16:9, not 4:3 — this is a scannable strip at the top of the page, not a gallery. */
		aspect-ratio: 16 / 9;
		object-fit: cover;
		background: var(--navy-900);
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.thumb--generated {
		position: relative;
		overflow: hidden;
	}
	.thumb--generated svg {
		display: block;
		inline-size: 100%;
		block-size: 100%;
	}
</style>
