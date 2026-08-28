<script lang="ts">
	import { formatEventTime } from '@hendingar/core/datetime';
	import EventTile from '../EventTile.svelte';
	import { listToday } from '../../events.remote';

	// Top-level await: this is the first thing a visitor reads, so it must be in the HTML the
	// server sends, not fetched afterwards.
	const events = await listToday(6);
	const now = new Date();
	const todayCount = events.filter((e) => e.isToday).length;
</script>

<section class="today" aria-labelledby="h-today">
	<div class="shell">
		<div class="today__head">
			<div>
				<p class="label">
					{formatEventTime(now, 'Europe/Oslo', 'full').replace(/,.*$/, '')}
				</p>
				<h2 id="h-today" class="display today__h">
					{#if todayCount > 0}Kva skjer i dag{:else}Kva skjer no{/if}
				</h2>
			</div>
			<a class="btn today__more" href="/hendingar">Vis fleire</a>
		</div>

		{#if events.length === 0}
			<p class="today__empty">
				Ingen hendingar registrerte enno.
				<a href="/datasamling">Sjå kva vi hentar inn →</a>
			</p>
		{:else}
			<ul class="grid">
				{#each events as event (event.id)}
					<li><EventTile {event} /></li>
				{/each}
			</ul>

			<p class="today__foot">
				{#if todayCount > 0}
					{todayCount}
					{todayCount === 1 ? 'hending' : 'hendingar'} i dag — resten er dei næraste framover.
				{:else}
					Ingenting i dag. Dette er dei næraste framover.
				{/if}
				<a href="/hendingar">Alle hendingar →</a>
			</p>
		{/if}
	</div>
</section>

<style>
	.today {
		padding-block: clamp(1.5rem, 4vw, 3rem) clamp(2rem, 5vw, 4rem);
		border-block-end: var(--rule) solid var(--peach-line);
		container-type: inline-size;
	}
	.today__head {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: end;
		justify-content: space-between;
		margin-block-end: clamp(1.25rem, 3vw, 2rem);
	}
	.today__h {
		font-size: clamp(1.6rem, 7cqw, 4rem);
		margin-block: 0.2em 0;
	}
	.today__more {
		flex: none;
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		/*
		 * Explicit column counts, not auto-fill. auto-fill chose 5 columns at desktop width, which
		 * left the sixth tile stranded on its own row. Six items want a factor of six.
		 */
		grid-template-columns: 1fr;
		gap: clamp(0.75rem, 1.5vw, 1.25rem);
	}
	@media (width >= 40rem) {
		.grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (width >= 64rem) {
		.grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	/* All six in one row on a laptop, so the answer to "what's on today" is visible without
	   scrolling. Six items want a factor of six: 1 / 2 / 3 / 6. */
	@media (width >= 80rem) {
		.grid {
			grid-template-columns: repeat(6, 1fr);
		}
	}
	.grid li {
		display: grid;
		min-inline-size: 0;
	}
	.today__foot {
		margin-block: 1.25rem 0;
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.today__empty {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: var(--step-mid);
		text-transform: uppercase;
		max-inline-size: 34ch;
	}
</style>
