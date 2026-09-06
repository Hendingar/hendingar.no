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
			"Dei neste dagane", not "Kva skjer".

			This heading and the eyebrow above it were written when the list was the first thing on
			the page and had to introduce itself. The page now opens with an h1 reading "Kva skjer i
			Sunnhordland", so the old pair said the question twice within one screen and named the
			region twice with it. What is left says what this section is — the next few days — which
			is the one thing the h1 does not already say, and which the "Vis fleire" link beside it
			completes.
		-->
		<div class="up__head">
			<h2 id="h-up" class="display up__h">Dei neste dagane</h2>
			<a class="btn up__more" href="/hendingar">Vis fleire</a>
		</div>

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
		padding-block: clamp(1.5rem, 4vw, 3rem) clamp(2rem, 5vw, 4rem);
		border-block-end: var(--rule) solid var(--peach-line);
		container-type: inline-size;
	}
	.up__head {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: end;
		justify-content: space-between;
		margin-block-end: clamp(1.25rem, 3vw, 2rem);
	}
	/*
	 * A section heading now, not the page's opening statement — so it stops short of the display
	 * sizes above it. 4rem here would compete with the h1 one screen up and flatten the hierarchy
	 * the page was rearranged to create. "Dei neste dagane" is also three times the length of the
	 * two words this used to hold, and needs the smaller step to stay on one line.
	 */
	.up__h {
		font-size: clamp(1.35rem, 4cqw, 2.125rem);
		margin-block: 0;
	}
	.up__more {
		flex: none;
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
