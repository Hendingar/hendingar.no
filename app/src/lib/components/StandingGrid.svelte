<script lang="ts">
	import StandingCard from './StandingCard.svelte';
	import type { StandingOffer } from '../events.remote';

	/**
	 * The same grid `EventGrid` lays out, for standing offers.
	 *
	 * Its own component rather than a flag on `EventGrid`, because the two take different rows and
	 * render different cards — a shared one would be a component with two shapes and a branch at the
	 * top, which is how both halves end up half-maintained. The breakpoints are deliberately
	 * identical so the page reads as one page.
	 */
	let { offers, limit = null }: { offers: StandingOffer[]; limit?: number | null } = $props();

	const shown = $derived(limit === null ? offers : offers.slice(0, limit));
</script>

<ul class="grid">
	{#each shown as offer, i (offer.id)}
		<li class="rise" style:--rise-delay="{Math.min(i, 7) * 45}ms">
			<StandingCard {offer} />
		</li>
	{/each}
</ul>

<style>
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(0.75rem, 1.5vw, 1.25rem);
	}
	/* Grid children default to min-width:auto, which lets a long title push its track wider than
	   its column — the single most common source of sideways scroll. */
	.grid li {
		display: grid;
		min-inline-size: 0;
	}
	@media (width >= 34rem) {
		.grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (width >= 60rem) {
		.grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	@media (width >= 80rem) {
		.grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}
</style>
