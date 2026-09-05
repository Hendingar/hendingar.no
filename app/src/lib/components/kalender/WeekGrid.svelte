<script lang="ts">
	import { WEEKDAY_ABBR, WEEKDAY_NAMES, formatEventClock } from '@hendingar/core/datetime';
	import { eventPath } from '@hendingar/core/slug';
	import { categoryLabel } from '@hendingar/core/taxonomy';
	import { blockMinutes, layOutDay, weekSpan } from '../../calendar.ts';
	import type { WeekSpanningEvent, WeekTimedEvent } from '../../events.remote';

	/**
	 * One week against a shared time axis.
	 *
	 * The month grid says how much; this says when. It is the view you want once you have found the
	 * week — two things at 19:00 on Friday is the fact that decides your evening, and no arrangement
	 * of day counts can show it.
	 *
	 * Everything is positioned from **minutes past midnight at the venue**, never from instants.
	 * Two events "at 19:00" belong on the same line even when one is in Oslo and the other in
	 * Helsinki and they are an hour apart as instants — a week view is a wall clock. The arithmetic
	 * lives in `calendar.ts` so it can be tested without rendering anything.
	 *
	 * There is no "now" line. It would have to be drawn from the clock at render time, so the
	 * server-rendered HTML and the hydrated page would disagree about where it goes, and a cached
	 * page would assert a time that had passed. Today's column is marked instead, which is stable.
	 */
	let {
		dates,
		timed,
		spanning,
		today
	}: {
		/** The week's seven calendar dates, måndag first. */
		dates: string[];
		timed: WeekTimedEvent[];
		spanning: WeekSpanningEvent[];
		today: string;
	} = $props();

	/** Minutes → the grid's own unit. One span for all seven days: columns whose hour lines do not
	 *  line up are not a week, they are seven unrelated charts side by side. */
	const blocks = $derived(timed.map((event) => ({ event, ...blockMinutes(event) })));
	const span = $derived(weekSpan(blocks));
	const hours = $derived(
		Array.from({ length: Math.ceil((span.end - span.start) / 60) }, (_, i) => span.start / 60 + i)
	);

	/** Laid out per day, so overlapping blocks split a column rather than hiding each other. */
	const byDay = $derived(
		dates.map((date) => ({
			date,
			placed: layOutDay(blocks.filter((b) => b.event.localDate === date))
		}))
	);

	/**
	 * How many events *start* on each day.
	 *
	 * Deliberately the same rule the month grid counts by, so the header here and the square there
	 * never disagree: an event belongs to the day it starts. A three-week exhibition is therefore
	 * counted once, on its opening day, even though the band draws it across all seven columns.
	 */
	const startCounts = $derived(
		new Map(
			dates.map((date) => [
				date,
				timed.filter((e) => e.localDate === date).length +
					spanning.filter((e) => !e.startsBefore && e.fromDate === date).length
			])
		)
	);

	/** Where a date sits in the outer frame. +2 because column 1 is the time gutter. */
	function column(date: string): number {
		return dates.indexOf(date) + 2;
	}

	/**
	 * Where a date sits inside the band, which is its own seven-column grid.
	 *
	 * The band spans the frame's day columns and re-declares seven equal tracks across exactly that
	 * width, so the two line up — but its own columns are numbered from 1, and reusing the frame's
	 * numbering here silently shifts every band one day to the right.
	 */
	function bandColumn(date: string): number {
		return dates.indexOf(date) + 1;
	}
</script>

<!--
	One horizontal scroller, not a second stacked layout for narrow screens.

	Seven readable columns need about 56rem; below that the week scrolls sideways with the time
	gutter pinned, which is what a phone calendar does and what the filter rows on /hendingar
	already taught this site. Rendering a separate list for small screens would mean two markups
	of the same week, and the one nobody is looking at is the one that rots.
-->
<div class="week" role="region" aria-label="Vekevising">
	<div class="week__frame">
		<div class="week__corner"></div>
		{#each dates as date, i (date)}
			{@const total = startCounts.get(date) ?? 0}
			<h3
				class="week__head"
				style:grid-column={column(date)}
				aria-current={date === today ? 'date' : undefined}
			>
				{#if total > 0}
					<a class="week__headlink" href="/kalender/{date}">
						<span class="week__wd">
							<span aria-hidden="true">{WEEKDAY_ABBR[i]}</span>
							<span class="visually-hidden">{WEEKDAY_NAMES[i]}</span>
						</span>
						<span class="week__date display display--md">{Number(date.slice(8))}</span>
						<span class="week__n">{total}</span>
					</a>
				{:else}
					<span class="week__headlink week__headlink--empty">
						<span class="week__wd">
							<span aria-hidden="true">{WEEKDAY_ABBR[i]}</span>
							<span class="visually-hidden">{WEEKDAY_NAMES[i]}</span>
						</span>
						<span class="week__date display display--md">{Number(date.slice(8))}</span>
					</span>
				{/if}
			</h3>
		{/each}

		{#if spanning.length > 0}
			<!--
				Things that run across days get a band rather than a block.

				A three-week exhibition has no meaningful 19:00. Drawing it on the grid would either
				claim it happens once or paint a column-tall rectangle over everything else.
			-->
			<p class="week__bandlabel">Går over<br />fleire dagar</p>
			<ul class="week__band">
				{#each spanning as event (event.id)}
					<li
						class="week__span"
						style:grid-column="{bandColumn(event.fromDate)} / {bandColumn(event.toDate) + 1}"
					>
						<a class="week__spanlink" href={eventPath(event.id, event.title)}>
							<!--
								A band clipped at måndag looks exactly like one that starts on måndag, so a run
								that continues past the edge of the week says so — with a chevron for everyone
								who can see it, and in words for everyone who cannot.
							-->
							{#if event.startsBefore}
								<span class="week__cont" aria-hidden="true">←</span>
								<span class="visually-hidden">Byrja før denne veka.</span>
							{/if}
							<span class="week__spantitle display display--sm">{event.title}</span>
							{#if event.venueName}<span class="week__spanvenue">{event.venueName}</span>{/if}
							{#if event.endsAfter}
								<span class="visually-hidden">Held fram etter denne veka.</span>
								<span class="week__cont week__cont--end" aria-hidden="true">→</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="week__gutter" style:--hours={hours.length}>
			{#each hours as hour (hour)}
				<span class="week__hour" style:--h={hour - span.start / 60}>
					{String(hour).padStart(2, '0')}
				</span>
			{/each}
		</div>

		{#each byDay as day (day.date)}
			<div
				class="week__col"
				class:week__col--today={day.date === today}
				style:grid-column={column(day.date)}
				style:--hours={hours.length}
			>
				{#each day.placed as block (block.event.id)}
					<a
						class="week__block"
						href={eventPath(block.event.id, block.event.title)}
						style:--from={block.start - span.start}
						style:--len={block.end - block.start}
						style:--col={block.column}
						style:--cols={block.columns}
					>
						<span class="week__time">
							{formatEventClock(block.event.startsAt, block.event.venueTimeZone)}
						</span>
						<span class="week__title display display--sm">{block.event.title}</span>
						<span class="week__meta">
							{block.event.venueName ?? categoryLabel(block.event.category)}
						</span>
					</a>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.week {
		overflow-x: auto;
		overscroll-behavior-x: contain;
		margin-inline: calc(var(--gutter, 1rem) * -1);
		padding-inline: var(--gutter, 1rem);
		container-type: inline-size;
		/*
		 * `contain: paint` is load-bearing, not an optimisation.
		 *
		 * `overflow-x: auto` alone did NOT stop this scroller's 832px of content reaching the
		 * viewport: the page scrolled sideways by 448px at 320px wide, while every element outside
		 * the scroller measured exactly 320. `container-type: inline-size` implies
		 * `contain: layout style inline-size` — note the absence of `paint` — and without it the
		 * scrollable overflow propagated out. Naming `paint` says what a scroller already means:
		 * nothing inside me is drawn outside me.
		 *
		 * Measured, not reasoned: `app/e2e/kalender.e2e.ts` scrolls the window and asserts it did
		 * not move. Remove this line and that spec fails.
		 */
		contain: paint;
	}
	/*
	 * No `tabindex` on the scroller.
	 *
	 * A scrollable region has to be keyboard-operable, which normally means making it focusable —
	 * but that is only true when it has no focusable children. This one always does: every day
	 * header and every block is a link, so tab walks through the week in reading order and the
	 * browser scrolls each one into view as it goes. A week with nothing in it never renders this
	 * component at all; the page shows its empty state instead.
	 */

	.week__frame {
		display: grid;
		/* The gutter, then seven equal days. `56rem` is the floor at which a title is still
		   readable inside a column; below it the parent scrolls rather than the columns shrinking. */
		grid-template-columns: 2.75rem repeat(7, minmax(6.5rem, 1fr));
		min-inline-size: 52rem;
		/* An hour of the day, as a length. Everything on the grid is positioned in multiples. */
		--hour: clamp(2.25rem, 3.4cqw, 3rem);
	}

	.week__corner {
		grid-column: 1;
		grid-row: 1;
		border-block-end: var(--rule) solid var(--peach-line);
	}

	.week__head {
		grid-row: 1;
		margin: 0;
		border-block-end: var(--rule) solid var(--peach-line);
		border-inline-start: var(--rule) solid var(--peach-line);
	}
	.week .week__headlink {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.6rem 0.5rem 0.5rem;
		text-decoration: none;
	}
	.week .week__wd {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.week .week__date {
		font-size: 1.35rem;
		color: var(--peach);
	}
	.week .week__headlink--empty .week__date {
		color: var(--peach-dim);
		opacity: 0.7;
	}
	.week .week__n {
		margin-inline-start: auto;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--peach-dim);
	}
	.week .week__headlink:hover .week__date {
		color: var(--peach-hi);
	}
	/* Today, by rule rather than by colour alone — `aria-current="date"` carries it either way. */
	.week .week__head[aria-current='date'] {
		border-block-end: var(--rule-fat) solid var(--peach);
	}

	.week__bandlabel {
		grid-column: 1;
		grid-row: 2;
		margin: 0;
		padding: 0.5rem 0.5rem 0.5rem 0;
		font-family: var(--font-mono);
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--peach-dim);
		text-align: end;
		line-height: 1.25;
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.week__band {
		grid-row: 2;
		grid-column: 2 / -1;
		display: grid;
		/*
		 * Seven equal tracks across exactly the width the seven day columns occupy, so the band
		 * lines up with them. `subgrid` would express the intent more directly and was tried first;
		 * its column numbering restarts at 1 inside the band, which is a trap worth avoiding for a
		 * layout this simple — the parent's day tracks are all `1fr`, so seven equal ones match.
		 */
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 0.25rem 0;
		list-style: none;
		margin: 0;
		padding: 0.4rem 0;
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.week .week__span {
		min-inline-size: 0;
	}
	.week .week__spanlink {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		/* The band is the one place a running event is stated, so it gets the ghost fill and a full
		   rule rather than a hairline — it has to survive being read across seven columns. */
		background: var(--peach-ghost);
		border: var(--rule) solid var(--peach);
		padding: 0.25rem 0.5rem;
		margin-inline: 0.15rem;
		text-decoration: none;
		overflow: hidden;
	}
	.week .week__spantitle {
		font-size: 0.875rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.week .week__cont {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		line-height: 1;
		color: var(--peach-dim);
		flex: none;
	}
	.week .week__cont--end {
		margin-inline-start: auto;
	}
	.week .week__spanlink:hover .week__cont {
		color: var(--navy-dim);
	}
	.week .week__spanvenue {
		font-family: var(--font-mono);
		font-size: 0.625rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--peach-dim);
		white-space: nowrap;
	}
	.week .week__spanlink:hover {
		background: var(--peach);
		color: var(--navy-900);
	}
	.week .week__spanlink:hover .week__spanvenue {
		color: var(--navy-dim);
	}

	.week__gutter {
		grid-column: 1;
		position: relative;
		block-size: calc(var(--hours) * var(--hour));
	}
	.week .week__hour {
		position: absolute;
		inset-inline-end: 0.5rem;
		/* Lifted half a line so the number sits *on* its rule rather than under it. */
		inset-block-start: calc(var(--h) * var(--hour) - 0.55em);
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--peach-dim);
	}

	.week__col {
		position: relative;
		block-size: calc(var(--hours) * var(--hour));
		border-inline-start: var(--rule) solid var(--peach-line);
		/*
		 * The hour rules, as one repeating gradient rather than N elements.
		 *
		 * Fourteen hairlines across seven columns is ninety-eight divs that exist only to be lines;
		 * a gradient is one paint and it can never drift out of step with the blocks, because both
		 * are positioned from the same `--hour`.
		 */
		background-image: repeating-linear-gradient(
			to bottom,
			var(--peach-line) 0 1px,
			transparent 1px var(--hour)
		);
	}
	/* Today's column, warmed very slightly. Never the only signal — the header carries the rule. */
	.week .week__col--today {
		background-color: var(--peach-ghost);
	}

	.week__block {
		position: absolute;
		inset-block-start: calc(var(--from) / 60 * var(--hour));
		block-size: calc(var(--len) / 60 * var(--hour));
		inset-inline-start: calc(var(--col) / var(--cols) * 100%);
		inline-size: calc(100% / var(--cols));
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		/* Peach paper, navy ink — the inverted block from the poster vocabulary. 8.29:1. */
		background: var(--peach);
		color: var(--navy-900);
		padding: 0.2rem 0.4rem 0.25rem;
		margin-inline: 0.1rem;
		text-decoration: none;
		overflow: hidden;
	}
	.week__block:hover {
		background: var(--peach-hi);
		z-index: 2;
	}
	.week .week__time {
		font-family: var(--font-mono);
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.12em;
	}
	.week .week__title {
		font-size: 0.8125rem;
		line-height: 1.05;
	}
	.week .week__meta {
		margin-block-start: auto;
		font-family: var(--font-mono);
		font-size: 0.5625rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--navy-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
