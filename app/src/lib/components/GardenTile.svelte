<script lang="ts">
	/**
	 * The card for a hagelag's activity.
	 *
	 * Hageselskapet's pages carry no picture of any kind — no image in the Event markup, none on
	 * the card, and an empty `og:image`, which `importers/bakhagen` records as `posterUrl: null`
	 * for every row it imports. So there is nothing to hotlink, and a fermenteringskurs looked
	 * exactly like every other thing we had no picture for.
	 *
	 * Their mark on white is what says whose it is, and the flowers are ours. A garden society's
	 * evening course deserves something that grows.
	 */
	let {
		id,
		feature = false
	}: {
		/** The event id. The flowers are arranged from it, so a course keeps its own bed. */
		id: number;
		/** The large card on the event's own page rather than a thumbnail in the listing. */
		feature?: boolean;
	} = $props();

	/**
	 * Five flowers, placed and timed from the id alone.
	 *
	 * Deterministic, like the generated tile it replaces: no `Math.random`, so the server and the
	 * browser draw the same bed and a screenshot test stays still. The spread is wide enough that
	 * two neighbouring courses do not look like the same picture.
	 */
	const flowers = $derived(
		Array.from({ length: 5 }, (_, i) => {
			const seed = (id * 7 + i * 31) % 97;
			return {
				x: 44 + i * 78 + (seed % 17),
				/** Stem height, so the row is a bed rather than a fence. */
				height: 54 + (seed % 23),
				petals: 5 + (seed % 2),
				/** Each flower sways on its own clock, or they nod like a metronome. */
				delay: ((seed % 13) / 13) * -6,
				head: 9 + (seed % 4)
			};
		})
	);
</script>

<div class="thumb garden" class:garden--feature={feature} role="img" aria-label="Hageselskapet">
	<svg viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
		<rect width="400" height="225" fill="var(--paper)" />

		<!--
			Their logo, as a file rather than inline markup: one cached request instead of 24 KB in
			every card, and what we hold stays plainly their asset in one place. See the note in
			static/hageselskapet.svg.
		-->
		<image
			href="/hageselskapet.svg"
			x="92"
			y="34"
			width="216"
			height="70"
			preserveAspectRatio="xMidYMid meet"
		/>

		<g class="garden__bed">
			{#each flowers as flower, i (i)}
				<g
					class="garden__flower"
					style:--delay="{flower.delay}s"
					style:transform-origin="{flower.x}px 212px"
				>
					<path
						class="garden__stem"
						d="M{flower.x} 212 C{flower.x - 6} {212 - flower.height * 0.5} {flower.x + 6} {212 -
							flower.height * 0.7} {flower.x} {212 - flower.height}"
						fill="none"
						stroke="var(--leaf)"
						stroke-width="2.5"
						stroke-linecap="round"
					/>
					<g style:transform="translate({flower.x}px, {212 - flower.height}px)">
						{#each Array.from({ length: flower.petals }, (_, p) => p) as petal (petal)}
							<ellipse
								class="garden__petal"
								cx="0"
								cy={-flower.head * 0.72}
								rx={flower.head * 0.42}
								ry={flower.head * 0.72}
								fill="var(--bloom)"
								style:transform="rotate({(360 / flower.petals) * petal}deg)"
							/>
						{/each}
						<circle r={flower.head * 0.36} fill="var(--bloom-heart)" />
					</g>
				</g>
			{/each}
		</g>
	</svg>
</div>

<style>
	/*
	 * The box, same four declarations every thumbnail in this listing needs. `.thumb` is declared
	 * in EventThumb's scoped stylesheet and does not reach here; the class on the root is for the
	 * parents' `:global` rules — the hover scale, and the 5.5rem square below 34rem.
	 */
	.garden {
		display: block;
		inline-size: 100%;
		block-size: auto;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		background: var(--paper);
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.garden svg {
		display: block;
		inline-size: 100%;
		block-size: 100%;
	}

	/*
	 * The sway.
	 *
	 * Transform only, and on the stem's own origin at the soil line, so each flower bends from
	 * where it is planted rather than sliding. `brand.css` already reduces every animation on the
	 * page to nothing under `prefers-reduced-motion`, which is the whole accessibility story here.
	 */
	.garden__flower {
		animation: garden-sway 7s ease-in-out infinite alternate;
		animation-delay: var(--delay);
	}
	.garden--feature .garden__flower {
		animation-duration: 5.5s;
	}

	@keyframes garden-sway {
		from {
			transform: rotate(-3.5deg);
		}
		to {
			transform: rotate(3.5deg);
		}
	}
</style>
