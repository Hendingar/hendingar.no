<script lang="ts">
	import { eventPath } from '@hendingar/core/slug';
	import { formatDayLabel, formatEventClock, machineDateTime } from '@hendingar/core/datetime';
	import { screeningDays, showsInSeveralRooms, type Screening } from '../screenings.ts';

	/**
	 * A film's screenings: one line per day, its times beside it, every time a link.
	 *
	 * Shared by the cinema card's "Vis alle tider" panel and the "Alle tider" section on the event
	 * page, so the two cannot disagree about what "all" means. Each time is its own event with its
	 * own page — this is a list of links, not a picker.
	 */
	let {
		title,
		screenings,
		todayLocalDate,
		currentId
	}: {
		/** The film's title, which every screening shares and every link is built from. */
		title: string;
		screenings: Screening[];
		todayLocalDate: string | null;
		/** The screening being looked at, marked so the reader can find their place. */
		currentId: number;
	} = $props();

	const days = $derived(screeningDays(screenings));
	const rooms = $derived(showsInSeveralRooms(screenings));
</script>

{#if screenings.length === 0}
	<p class="st__none">Ingen fleire visingar er lagde ut.</p>
{:else}
	<ul class="st" aria-label={`Visingar av ${title}`}>
		{#each days as day (day.localDate)}
			<li class="st__day">
				<span class="st__d">{formatDayLabel(day.localDate, todayLocalDate ?? day.localDate)}</span>
				<ul class="st__times">
					{#each day.screenings as screening (screening.id)}
						<li>
							<a
								class="st__t"
								href={eventPath(screening.id, title)}
								aria-current={screening.id === currentId ? 'true' : undefined}
							>
								<time datetime={machineDateTime(screening.startsAt)}>
									{formatEventClock(screening.startsAt, screening.venueTimeZone)}
								</time>
								{#if rooms && screening.venueName}
									<span class="st__room">{screening.venueName}</span>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.st,
	.st__times {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.st {
		display: grid;
		gap: 0.6rem;
	}
	/*
	 * The day above its times, not beside them: "Torsdag 15. oktober" is twice the width of
	 * "I dag", and as a column it wrapped on a phone and pushed every row's times out of line.
	 */
	.st__day {
		display: grid;
		gap: 0.25rem;
	}
	.st__d {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.st__times {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.st__t {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4em;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.08em;
		text-decoration: none;
		color: var(--peach);
		border: var(--rule) solid var(--peach-line);
		padding: 0.2em 0.5em;
	}
	.st__t:hover {
		border-color: var(--peach);
	}
	/* The screening being looked at, filled like the lead time in a stacked card. */
	.st__t[aria-current='true'] {
		background: var(--peach);
		color: var(--navy-900);
		border-color: var(--peach);
	}
	.st__room {
		font-size: 0.85em;
		letter-spacing: 0.04em;
	}
	.st__none {
		margin: 0;
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}
</style>
