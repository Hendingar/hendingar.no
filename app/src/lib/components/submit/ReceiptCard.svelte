<script lang="ts">
	import EventGrid from '../EventGrid.svelte';
	import { eventTile } from '../../events.remote';

	/**
	 * The published event as the listing draws it, linked to its page.
	 *
	 * "Publisert" used to be a word and a button. The card is the proof: it is what a reader will
	 * see, thumbnail included — so a picture that did not make it onto the event shows up here as
	 * a generated tile, instead of hiding behind the local copy the form still holds.
	 *
	 * The same grid the listing uses, not a fourth card shape (see EventGrid).
	 */
	let { id }: { id: number } = $props();

	const tile = $derived(await eventTile(id));
</script>

{#if tile}
	<div class="receipt-card">
		<p class="label">Slik ligg ho på lista</p>
		<EventGrid events={[tile]} />
	</div>
{/if}

<style>
	.receipt-card {
		padding: 0 clamp(1rem, 3vw, 1.75rem) 1.25rem;
		display: grid;
		gap: 0.6rem;
	}
</style>
