<script lang="ts">
	import EventGrid from '../../../lib/components/EventGrid.svelte';
	import { listPopular } from '../../../lib/events.remote';

	/**
	 * Upcoming events, most opened first.
	 *
	 * Top-level await for the same reason as the hearts ordering: this is public content and has to
	 * be in the server-rendered HTML.
	 */
	const events = await listPopular({ by: 'views' });

	const hearts = $derived(Object.fromEntries(events.map((e) => [e.id, e.hearts])));
	const views = $derived(Object.fromEntries(events.map((e) => [e.id, e.views])));
	const anyViews = $derived(events.some((e) => e.views > 0));
</script>

<svelte:head>
	<title>Mest opna — hendingar.no</title>
	<meta
		name="description"
		content="Hendingar som kjem i Sunnhordland, sortert etter kor mange som har opna dei."
	/>
</svelte:head>

<section class="list shell">
	{#if events.length === 0}
		<p class="list__empty">
			Ingenting på plakaten akkurat no. Sjå <a href="/hendingar">alle hendingar</a>.
		</p>
	{:else}
		{#if !anyViews}
			<p class="list__note">Ingen har opna noko enno, så dette er berre det som skjer først.</p>
		{/if}
		<!--
			What the number counts, said where the number is.

			"Opna" rather than "vist": we count browsers that opened the page, and we cannot know
			whether anyone read it. Calling that a view would be claiming more than we measure.
		-->
		<p class="list__what">
			Talet er kor mange nettlesarar som har opna hendinga. Vi tel éin gong per nettlesar, og vi
			lagrar ikkje kven som opna kva.
		</p>
		<EventGrid {events} {hearts} {views} />
	{/if}
</section>

<style>
	.list {
		padding-block: clamp(1rem, 3vw, 2rem) clamp(3rem, 8vw, 5rem);
		display: grid;
		gap: 1rem;
	}
	.list__empty,
	.list__note,
	.list__what {
		margin: 0;
		max-inline-size: 60ch;
		color: var(--peach-dim);
	}
</style>
