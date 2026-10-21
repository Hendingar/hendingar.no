<script lang="ts">
	import EventGrid from '../../../lib/components/EventGrid.svelte';
	import PageMeta from '../../../lib/components/PageMeta.svelte';
	import { listPopular } from '../../../lib/events.remote';
	import { viewHistory } from '../../../lib/views.remote';
	import { trends as trendsOf } from '../../../lib/trend.ts';

	/**
	 * Upcoming events, most opened first.
	 *
	 * Top-level await for the same reason as the hearts ordering: this is public content and has to
	 * be in the server-rendered HTML.
	 */
	const events = await listPopular({ by: 'views' });
	// The fortnight behind each card, in the same server render: a sparkline that arrived after
	// hydration would be a page that shifts under the reader's thumb.
	const history = await viewHistory(events.map((e) => e.id));

	const hearts = $derived(Object.fromEntries(events.map((e) => [e.id, e.hearts])));
	const views = $derived(Object.fromEntries(events.map((e) => [e.id, e.views])));
	const anyViews = $derived(events.some((e) => e.views > 0));
	const trends = $derived(
		trendsOf(
			events.map((e) => ({ id: e.id, total: e.views, today: e.viewsToday, startsAt: e.startsAt })),
			history.days,
			history.today
		)
	);
</script>

<PageMeta
	title="Mest opna — hendingar.no"
	description="Hendingar som kjem i Sunnhordland, sortert etter kor mange som har opna dei."
	path="/poppis/vist"
/>

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
		<!--
			How to read the line under each card, once, rather than a legend on every one. The bars
			are a count per day, which is all we keep — no more a history of who than the total is.
		-->
		<p class="list__key">
			Under kvart kort: plassen på lista, opningar per dag dei siste to vekene, og kor mykje ho har
			flytta seg sidan i går.
		</p>
		<EventGrid {events} {hearts} {views} {trends} />
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
	.list__what,
	.list__key {
		margin: 0;
		max-inline-size: 60ch;
		color: var(--peach-dim);
	}
</style>
