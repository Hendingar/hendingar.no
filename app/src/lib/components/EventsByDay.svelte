<script lang="ts">
	import { formatDayLabel } from '@hendingar/core/datetime';
	import EventTile from './EventTile.svelte';
	import { stackOccurrences } from '../occurrences.ts';
	import type { UpcomingEvent } from '../events.remote';

	/**
	 * A day-grouped grid of events.
	 *
	 * Extracted from the landing section so /hendingar renders the same thing. It previously had a
	 * plain bulleted list with no thumbnails and no dates, which meant the page you land on after
	 * "vis fleire" looked like a different product from the one you clicked out of.
	 *
	 * `headingLevel` exists because the day headings are h3 under the landing page's h2 section but
	 * h2 under /hendingar's h1. Hardcoding either one breaks the document outline on the other page.
	 */
	let {
		events,
		headingLevel = 3,
		hearts = {}
	}: {
		events: UpcomingEvent[];
		headingLevel?: 2 | 3;
		/**
		 * Heart counts by event id, fetched in bulk by the page.
		 *
		 * Passed down rather than fetched per card: a listing shows two dozen tiles, and a request
		 * each would be two dozen round trips for a number nobody scrolled to yet.
		 */
		hearts?: Record<number, number>;
	} = $props();

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

{#each days as day (day.date)}
	<!-- Each day is its own labelled region, so the date is part of the document structure rather
	     than a visual grouping a screen reader cannot perceive. -->
	<section class="day" aria-labelledby={`day-${day.date}`}>
		{#if headingLevel === 2}
			<h2 id={`day-${day.date}`} class="display day__h">
				{day.label}
				<span class="day__n">{day.events.length}</span>
			</h2>
		{:else}
			<h3 id={`day-${day.date}`} class="display day__h">
				{day.label}
				<span class="day__n">{day.events.length}</span>
			</h3>
		{/if}
		<ul class="grid">
			<!--
				Repeats of the same event share a card. Public swimming runs four times a day; four
				identical posters spend a screenful saying one thing. Each time is still its own
				event with its own page — the grouping is presentation only.
			-->
			{#each stackOccurrences(day.events) as stack (stack.lead.id)}
				<li>
					<EventTile
						event={stack.lead}
						occurrences={stack.occurrences}
						hearts={hearts[stack.lead.id] ?? 0}
					/>
				</li>
			{/each}
		</ul>
	</section>
{/each}

<style>
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
	/*
	 * The day heading sticks while you scroll its events.
	 *
	 * A consequence of the density work rather than decoration: fitting 5.6 events on a phone
	 * instead of 2.7 means a day's worth of them now runs well past the heading that names it, so
	 * "which day am I looking at" becomes the question the list stops answering. Sticky only on
	 * narrow screens, where the grid is a single column and the answer genuinely scrolls away.
	 *
	 * It needs its own background: the events pass underneath, and a transparent heading over a
	 * poster is unreadable.
	 */
	@media (width < 34rem) {
		.day__h {
			position: sticky;
			inset-block-start: 0;
			z-index: 2;
			background: var(--navy-800);
			margin-block-end: 0.55rem;
			padding-block: 0.45rem 0.4rem;
		}
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
</style>
