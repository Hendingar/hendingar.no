<script lang="ts">
	import type { Snippet } from 'svelte';
	import EventCard from './EventCard.svelte';
	import type { EventSummary } from '../events.remote';

	/**
	 * Takes an already-resolved array, not a query — so the caller decides how to suspend. Callers
	 * `await` the remote query inside a `<svelte:boundary>`, which is what makes the events appear
	 * in the server-rendered HTML. Rendering the query's `.loading` flag instead meant SSR always
	 * emitted "Lastar…" and every event was client-only: invisible to crawlers and to no-JS
	 * visitors, on a site whose entire purpose is discoverability.
	 */
	let {
		events,
		headingLevel = 3,
		empty
	}: { events: EventSummary[]; headingLevel?: 2 | 3; empty?: Snippet } = $props();
</script>

{#if events.length === 0}
	{#if empty}{@render empty()}{:else}
		<p class="empty">Ingen hendingar enno.</p>
	{/if}
{:else}
	<ul class="cards">
		{#each events as event (event.id)}
			<li><EventCard {event} {headingLevel} /></li>
		{/each}
	</ul>
{/if}

<style>
	.cards {
		list-style: none;
		padding: 0;
		margin: 0 0 2rem;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
		gap: var(--gutter);
	}
	/* Grid and flex children default to min-width:auto, which lets long content push the track
	   wider than its column. This is the single most common source of sideways scroll. */
	.cards > li {
		min-inline-size: 0;
	}
	.empty {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: var(--step-mid);
		text-transform: uppercase;
		line-height: 1.15;
		max-inline-size: 30ch;
	}
</style>
