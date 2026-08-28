<script lang="ts">
	import { formatDayLabel } from '@hendingar/core/datetime';
	import EventTile from '../EventTile.svelte';
	import { listUpcoming } from '../../events.remote';
	import type { UpcomingEvent } from '../../events.remote';

	// Top-level await: this is the first thing a visitor reads, so it must be in the server HTML.
	const events = await listUpcoming(24);

	type Day = { date: string; label: string; events: UpcomingEvent[] };

	/**
	 * Group by calendar day, preserving the query's chronological order.
	 *
	 * A plain array rather than a Map: the grouping is local to this render and never reactive, and
	 * the rows already arrive ordered, so consecutive runs of the same date are adjacent.
	 */
	function byDay(list: UpcomingEvent[]): Day[] {
		const days: Day[] = [];
		for (const event of list) {
			const current = days.at(-1);
			if (current && current.date === event.localDate) {
				current.events.push(event);
			} else {
				days.push({
					date: event.localDate,
					label: formatDayLabel(event.localDate, event.todayLocalDate),
					events: [event]
				});
			}
		}
		return days;
	}

	const days = $derived(byDay(events));
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

		{#if days.length === 0}
			<p class="up__empty">
				Ingen hendingar registrerte enno.
				<a href="/datasamling">Sjå kva vi hentar inn →</a>
			</p>
		{:else}
			{#each days as day (day.date)}
				<!-- Each day is its own labelled region, so the date is part of the document
				     structure rather than a visual grouping a screen reader cannot perceive. -->
				<section class="day" aria-labelledby={`day-${day.date}`}>
					<h3 id={`day-${day.date}`} class="display day__h">
						{day.label}
						<span class="day__n">{day.events.length}</span>
					</h3>
					<ul class="grid">
						{#each day.events as event (event.id)}
							<li><EventTile {event} /></li>
						{/each}
					</ul>
				</section>
			{/each}

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

	.day + .day {
		margin-block-start: clamp(1.5rem, 3vw, 2.5rem);
	}
	.day__h {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		font-size: clamp(1rem, 3cqw, 1.5rem);
		margin-block: 0 0.8rem;
		padding-block-end: 0.5rem;
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.day__n {
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: var(--step-micro);
		letter-spacing: 0.18em;
		color: var(--peach-dim);
	}

	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(0.75rem, 1.5vw, 1.25rem);
	}
	.grid li {
		display: grid;
		min-inline-size: 0;
	}
	@media (width >= 34rem) {
		.grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (width >= 60rem) {
		.grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	@media (width >= 80rem) {
		.grid {
			grid-template-columns: repeat(4, 1fr);
		}
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
