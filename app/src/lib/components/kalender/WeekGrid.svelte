<script lang="ts">
	import { WEEKDAY_ABBR, WEEKDAY_NAMES, formatEventClock } from '@hendingar/core/datetime';
	import { eventPath } from '@hendingar/core/slug';
	import { categoryLabel } from '@hendingar/core/taxonomy';
	import {
		blockMinutes,
		capLanes,
		laneCount,
		layOutDay,
		outsideSpan,
		weekSpan
	} from '../../calendar.ts';
	import WeekPeek from './WeekPeek.svelte';
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

	/**
	 * The ones the axis cannot hold, and the ones it can.
	 *
	 * A 02:00 night is a real thing to go to. The grid refuses to open at 02:00 for it — that put
	 * seven empty hours above everything else — so it is listed above the grid instead, with its
	 * clock time. Shown, not placed; the alternative was showing it and wrecking the week, or
	 * placing it and losing it.
	 */
	const outside = $derived(outsideSpan(blocks, span));
	const inSpan = $derived(blocks.filter((b) => !outside.includes(b)));

	/**
	 * Laid out per day, then capped.
	 *
	 * Splitting a column between everything that overlaps is right up to a point and catastrophic
	 * past it: a real Saturday here runs fourteen things at once, which tiled down to 17px each and
	 * rendered one letter per line. `capLanes` keeps what stays legible and turns the rest into an
	 * exact count linking to the day page, which already shows every event as a full tile.
	 */
	const byDay = $derived(
		dates.map((date) => ({
			date,
			...capLanes(layOutDay(inSpan.filter((b) => b.event.localDate === date)))
		}))
	);

	/**
	 * One column width for the whole week, taken from its busiest run.
	 *
	 * A day column has to be wide enough that its own lanes are readable, and all seven have to
	 * match or it is not a week. So a quiet week stays narrow enough to fit a laptop, and a busy
	 * one widens and scrolls — which is the honest trade, because the alternative is slivers.
	 */
	const lanes = $derived(laneCount(byDay));

	/*
	 * The hover preview.
	 *
	 * `null` until the pointer lands on a block, so nothing about it exists during SSR and there is
	 * no hydration mismatch to arrange. Opened on focus as well as hover, so a keyboard reader
	 * tabbing the grid gets the same card.
	 */
	let peek = $state<{ event: WeekTimedEvent; x: number; y: number } | null>(null);

	/** Roughly the card's size. Only used to decide which side of the block it opens on. */
	const PEEK_W = 272;
	const PEEK_H = 300;

	function openPeek(item: WeekTimedEvent, target: EventTarget | null, viaFocus = false) {
		if (!(target instanceof HTMLElement)) return;
		/*
		 * Hover opens it only where hovering is a thing the device does.
		 *
		 * On a touchscreen `mouseenter` fires synthetically on tap, so without this the card would
		 * flash over the block a finger is already committed to opening. Focus always opens it:
		 * that is the keyboard reader's route in, and it is deliberate on any device.
		 */
		if (!viaFocus && !window.matchMedia('(hover: hover)').matches) return;
		const r = target.getBoundingClientRect();
		const room = window.innerWidth - r.right;
		peek = {
			event: item,
			// Flip to the left when the block is close to the right edge, so the card never opens
			// off-screen on the Sunday column.
			x: room > PEEK_W + 16 ? r.right + 12 : Math.max(8, r.left - PEEK_W - 12),
			// And ride up when the block is low, so a 21:00 concert's card is not half below the fold.
			y: Math.max(8, Math.min(r.top, window.innerHeight - PEEK_H - 8))
		};
	}

	function closePeek() {
		peek = null;
	}

	/**
	 * The block's accessible name, written out in full.
	 *
	 * The visible text inside a block is truncated by its own height — a 30-minute slot shows a
	 * time and little else. If the name were built from that text, how a link is announced would
	 * depend on how tall its box happened to be, and the shortest events would be the least
	 * findable. Naming the link explicitly and marking the visible spans decorative keeps the two
	 * independent: the layout can clip whatever it needs to.
	 */
	function blockLabel(item: WeekTimedEvent): string {
		const at = formatEventClock(item.startsAt, item.venueTimeZone);
		const where = item.venueName ? `, ${item.venueName}` : '';
		return `${at} ${item.title}${where}`;
	}

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
	<div class="week__frame" style:--lanes={lanes}>
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

		{#if outside.length > 0}
			<p class="week__bandlabel week__bandlabel--outside">Utanom<br />rutenettet</p>
			<ul class="week__band week__band--outside">
				{#each outside as block (block.event.id)}
					<li class="week__span" style:grid-column={bandColumn(block.event.localDate)}>
						<a
							class="week__spanlink"
							href={eventPath(block.event.id, block.event.title)}
							onmouseenter={(e) => openPeek(block.event, e.currentTarget)}
							onmouseleave={closePeek}
							onfocus={(e) => openPeek(block.event, e.currentTarget, true)}
							onblur={closePeek}
						>
							<span class="week__spantime">
								{formatEventClock(block.event.startsAt, block.event.venueTimeZone)}
							</span>
							<span class="week__spantitle display display--sm">{block.event.title}</span>
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
				{#each day.visible as block (block.event.id)}
					<a
						class="week__block"
						href={eventPath(block.event.id, block.event.title)}
						style:--from={block.start - span.start}
						style:--len={block.end - block.start}
						style:--col={block.column}
						style:--cols={block.columns}
						onmouseenter={(e) => openPeek(block.event, e.currentTarget)}
						onmouseleave={closePeek}
						onfocus={(e) => openPeek(block.event, e.currentTarget, true)}
						onblur={closePeek}
						aria-label={blockLabel(block.event)}
					>
						<!-- Decorative: the link is named above, so clipping any of this is free. -->
						<span class="week__time" aria-hidden="true">
							{formatEventClock(block.event.startsAt, block.event.venueTimeZone)}
						</span>
						<span class="week__title display display--sm" aria-hidden="true">
							{block.event.title}
						</span>
						<span class="week__meta" aria-hidden="true">
							{block.event.venueName ?? categoryLabel(block.event.category)}
						</span>
					</a>
				{/each}

				<!--
					What did not fit, counted rather than dropped.

					A link to the day page, which renders every one of them as a full tile — so the
					grid can stay legible without the week quietly becoming a lie about how much is on.
				-->
				{#each day.overflow as more, i (i)}
					<a
						class="week__more"
						href="/kalender/{day.date}"
						style:--from={more.start - span.start}
						style:--len={more.end - more.start}
						style:--col={more.column}
						style:--cols={more.columns}
						aria-label="{more.count} hendingar til denne dagen"
					>
						<span class="week__morecount">+{more.count}</span>
						<span class="week__morelabel">fleire</span>
					</a>
				{/each}
			</div>
		{/each}
	</div>
</div>

<!--
	Outside `.week`, not inside it. The scroller carries `contain: paint`, which clips fixed-position
	descendants as well as scrolled ones — a card rendered inside would be cut off by exactly the
	edge it exists to escape.
-->
{#if peek}
	<WeekPeek event={peek.event} x={peek.x} y={peek.y} />
{/if}

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
		/*
		 * Wide enough that this week's busiest run is readable, and no wider.
		 *
		 * `--lanes` comes from the data: one lane is a quiet week that fits a laptop, three is a
		 * Saturday with more on than a column can hold. 5rem a lane is the floor at which a block
		 * still shows a time and a clipped title rather than one letter per line.
		 */
		grid-template-columns: 2.75rem repeat(7, minmax(max(6.5rem, calc(var(--lanes) * 5rem)), 1fr));
		/*
		 * An hour of the day, as a length — and deliberately NOT in `cqw`.
		 *
		 * A container unit here would be re-resolved inside every block, because a block is itself
		 * a size container (for the rules below), and `--hour` is inherited as a token rather than
		 * as a computed length. Every block would then be positioned against its own width.
		 */
		--hour: 2.5rem;
		/* Never narrower than seven readable columns; the parent scrolls instead. */
		min-inline-size: calc(2.75rem + 7 * max(6.5rem, var(--lanes) * 5rem));
	}

	@media (width >= 60rem) {
		.week__frame {
			--hour: 3rem;
		}
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
		/* Both band rows share this; `grid-row` is what tells them apart. */
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
	.week .week__spantime {
		font-family: var(--font-mono);
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		background: var(--peach);
		color: var(--navy-900);
		padding: 0.1em 0.35em;
		flex: none;
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
	/*
	 * The second band row, and it must be declared after `.week__band` rather than before it.
	 * Both selectors are one class, so source order is the whole of the cascade here — put this
	 * first and the row-2 rule silently wins, which drops the out-of-hours events into the
	 * multi-day band beside a three-week exhibition.
	 */
	.week__bandlabel--outside,
	.week__band--outside {
		grid-row: 3;
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
		/*
		 * The block sizes its own contents.
		 *
		 * A block's height is its duration, so a 30-minute slot is 20px tall and a three-hour one
		 * is 150px. One fixed layout for both meant the short ones clipped their venue line
		 * mid-glyph — text spilling over the edge of the peach, which reads as broken rather than
		 * as truncated. Each piece now drops out at the height below which it cannot be read.
		 */
		container: weekblock / size;
	}
	.week__block:hover,
	.week__block:focus-visible {
		background: var(--peach-hi);
		/* Raised so a hovered block in a three-lane run is legible over its neighbours. */
		z-index: 3;
	}

	/* Roughly: a venue line needs the block to be about four lines tall to be worth the space. */
	@container weekblock (height < 3.9rem) {
		.week__meta {
			display: none;
		}
	}

	@container weekblock (height < 2.9rem) {
		.week__title {
			-webkit-line-clamp: 1;
			line-clamp: 1;
		}
	}
	/*
	 * Under about 30px there is room for one line, and it is the title.
	 *
	 * Dropping the title instead was tried and looked exactly like a bug: a row of bare peach
	 * rectangles each showing a clock. The vertical position already says when a block starts —
	 * that is what a time grid is — so the time is the redundant half and the title is the only
	 * thing that says what the reader is looking at.
	 */
	@container weekblock (height < 1.9rem) {
		.week__time {
			display: none;
		}
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
		/* Clamped, not clipped: a cut-off line of display type reads as a rendering fault. */
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
	}
	/*
	 * What did not fit. A hairline frame rather than a filled block, because it is a count and a
	 * way onward, not an event — filling it would make it compete with the things it stands for.
	 */
	.week__more {
		position: absolute;
		inset-block-start: calc(var(--from) / 60 * var(--hour));
		block-size: calc(var(--len) / 60 * var(--hour));
		inset-inline-start: calc(var(--col) / var(--cols) * 100%);
		inline-size: calc(100% / var(--cols));
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.1rem;
		margin-inline: 0.1rem;
		border: var(--rule) dashed var(--peach);
		background: var(--peach-wash-2);
		text-decoration: none;
		overflow: hidden;
		container: weekblock / size;
	}
	.week__more:hover {
		background: var(--peach);
		color: var(--navy-900);
		border-style: solid;
		z-index: 3;
	}
	.week .week__morecount {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 112%;
		font-size: 0.9375rem;
		line-height: 1;
	}
	.week .week__morelabel {
		font-family: var(--font-mono);
		font-size: 0.5625rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.week__more:hover .week__morelabel {
		color: var(--navy-dim);
	}
	@container weekblock (height < 2.6rem) {
		.week__morelabel {
			display: none;
		}
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
