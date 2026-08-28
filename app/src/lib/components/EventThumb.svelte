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
		title
	}: { id: number; posterUrl?: string | null; title: string } = $props();

	// Deterministic per event: no Math.random, so a tile never changes between server and client
	// render, and a screenshot test stays stable.
	const variant = $derived(id % 4);
	const rotation = $derived((id % 7) * 13);
</script>

{#if posterUrl}
	<img
		class="thumb"
		src={posterUrl}
		alt=""
		loading="lazy"
		decoding="async"
		width="400"
		height="225"
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
