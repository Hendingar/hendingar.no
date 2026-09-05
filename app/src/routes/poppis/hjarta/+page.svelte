<script lang="ts">
	import EventGrid from '../../../lib/components/EventGrid.svelte';
	import { listPopular } from '../../../lib/events.remote';

	/**
	 * Upcoming events, most hearted first.
	 *
	 * Top-level await, not a `.loading` flag: this is public content and must exist in the
	 * server-rendered HTML for crawlers and for readers without JavaScript. See CLAUDE.md — a
	 * remote query's `loading` is always true during SSR, so a boundary here would ship a
	 * placeholder and no events.
	 */
	const events = await listPopular({ by: 'hearts' });

	/** The counts the grid already knows how to render, keyed the way it expects. */
	const hearts = $derived(Object.fromEntries(events.map((e) => [e.id, e.hearts])));

	/** Zero for everything means nobody has hearted anything yet, not that the query is broken. */
	const anyHearts = $derived(events.some((e) => e.hearts > 0));
</script>

<svelte:head>
	<title>Flest hjarte — hendingar.no</title>
	<meta
		name="description"
		content="Hendingar som kjem i Sunnhordland, sortert etter kor mange som har hjarta dei."
	/>
</svelte:head>

<section class="list shell">
	{#if events.length === 0}
		<p class="list__empty">
			Ingenting på plakaten akkurat no. Sjå <a href="/hendingar">alle hendingar</a>.
		</p>
	{:else}
		{#if !anyHearts}
			<!--
				Said once, at the top, rather than letting the page imply an order it does not have.
				With no hearts anywhere this is simply the soonest events — which is honest, and worth
				admitting instead of dressing up.
			-->
			<p class="list__note">
				Ingen har hjarta noko enno, så dette er berre det som skjer først. Trykk hjartet på eit kort
				for å ta vare på det — det blir liggjande i <a href="/hjarta">dine hjarte</a>.
			</p>
		{/if}
		<EventGrid {events} {hearts} />
	{/if}
</section>

<style>
	.list {
		padding-block: clamp(1rem, 3vw, 2rem) clamp(3rem, 8vw, 5rem);
		display: grid;
		gap: 1rem;
	}
	.list__empty,
	.list__note {
		margin: 0;
		max-inline-size: 60ch;
		color: var(--peach-dim);
	}
</style>
