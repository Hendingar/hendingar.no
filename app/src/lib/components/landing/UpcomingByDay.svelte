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
		<div class="up__head">
			<div>
				<p class="label">Sunnhordland</p>
				<h2 id="h-up" class="display up__h">Kva skjer</h2>
			</div>
			<a class="btn up__more" href="/hendingar">Vis fleire</a>
		</div>

		{#if events.length === 0}
			<p class="up__empty">
				Ingen hendingar registrerte enno.
				<a href="/datasamling">Sjå kva vi hentar inn →</a>
			</p>
		{:else}
			<EventsByDay {events} headingLevel={3} {hearts} />

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
	.up__h {
		font-size: clamp(1.6rem, 7cqw, 4rem);
		margin-block: 0.2em 0;
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
