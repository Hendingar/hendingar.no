<script lang="ts">
	import EventsByDay from '../EventsByDay.svelte';
	import { listUpcoming } from '../../events.remote';
	import { heartCounts } from '../../hearts.remote';

	// Top-level await: this is the first thing a visitor reads, so it must be in the server HTML.
	const events = await listUpcoming(24);
	/*
	 * Counts come with the list, in one query, and are server-rendered like everything else.
	 *
	 * How many people have hearted something is public — unlike *which* events a given reader
	 * hearted, which never leaves their browser.
	 */
	const hearts = Object.fromEntries(
		(await heartCounts(events.map((e) => e.id))).map((h) => [h.eventId, h.hearts])
	);
</script>

<section class="up" aria-labelledby="h-up">
	<div class="shell">
		<!--
			Heard, not shown. The tabs above already say when and the day headings below say which
			day, so a third heading in display type with a "Vis fleire" beside it was a row of chrome
			between the search field and the first event. The h2 stays for the outline the day
			headings (h3) hang from; "Alle hendingar →" under the list and "Alt framover" above it
			are the two ways onward that remain.
		-->
		<h2 id="h-up" class="visually-hidden">Dei neste dagane</h2>

		{#if events.length === 0}
			<p class="up__empty">
				Ingen hendingar registrerte enno.
				<a href="/datasamling">Sjå kva vi hentar inn →</a>
			</p>
		{:else}
			<!--
				The first day leads: wider cards, and a calendar link on each.

				What is on today is the question this page exists to answer, and rendering it in the
				same 4-up grid as the rest of the fortnight made the most useful row on the site look
				exactly like all the others.
			-->
			<EventsByDay {events} headingLevel={3} {hearts} featureFirstDay />

			<p class="up__foot">
				<a href="/hendingar">Alle hendingar →</a>
			</p>
		{/if}
	</div>
</section>

<style>
	.up {
		padding-block: clamp(1.25rem, 3vw, 2rem) clamp(2rem, 5vw, 4rem);
		border-block-end: var(--rule) solid var(--peach-line);
		container-type: inline-size;
	}
	.up__foot {
		margin-block: 1.5rem 0;
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}
	.up__empty {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: var(--step-mid);
		text-transform: uppercase;
		max-inline-size: 34ch;
	}
</style>
