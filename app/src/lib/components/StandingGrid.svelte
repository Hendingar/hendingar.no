<script lang="ts">
	import StandingCard from './StandingCard.svelte';
	import type { StandingOffer } from '../events.remote';

	/**
	 * The same grid `EventGrid` lays out, for standing offers.
	 *
	 * Its own component rather than a flag on `EventGrid`, because the two take different rows and
	 * render different cards — a shared one would be a component with two shapes and a branch at the
	 * top, which is how both halves end up half-maintained. The grid itself is `.tile-grid`
	 * in brand.css, shared, so the page reads as one page.
	 */
	let { offers, limit = null }: { offers: StandingOffer[]; limit?: number | null } = $props();

	const shown = $derived(limit === null ? offers : offers.slice(0, limit));
</script>

<ul class="tile-grid">
	{#each shown as offer, i (offer.id)}
		<li class="rise" style:--rise-delay="{Math.min(i, 7) * 45}ms">
			<StandingCard {offer} />
		</li>
	{/each}
</ul>
