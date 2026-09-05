<script lang="ts">
	import { page } from '$app/state';
	import {
		addDays,
		formatMonthName,
		formatWeekName,
		formatWeekRange,
		isIsoWeek,
		isoWeekKey,
		isoWeekStart,
		shiftWeek
	} from '@hendingar/core/datetime';
	import HorizonRail from '../../lib/components/kalender/HorizonRail.svelte';
	import Hotspots from '../../lib/components/kalender/Hotspots.svelte';
	import MonthGrid from '../../lib/components/kalender/MonthGrid.svelte';
	import WeekGrid from '../../lib/components/kalender/WeekGrid.svelte';
	import { isMonthKey, monthBounds, monthKeyOf, shiftMonth } from '../../lib/calendar.ts';
	import {
		calendarRange,
		horizonWeeks,
		dayCounts,
		placeCounts,
		weekEvents
	} from '../../lib/events.remote';

	/**
	 * The calendar: the same events as `/hendingar`, asked by date instead of in order.
	 *
	 * Three instruments, each answering a question the others structurally cannot:
	 *
	 * - the **rail** — *when* is it busy, over the whole half-year we can see;
	 * - the **month** — how much is on each day, and which days are the peaks;
	 * - the **week** — what is on at the same time, which is what actually decides an evening.
	 *
	 * All three are addressed by URL (`?maanad=2026-09`, `?veke=2026-W37`), not by component state.
	 * The same decision `/hendingar` made about its filters, for the same reasons: a view is
	 * linkable, shareable and back-buttonable, it survives JavaScript being off, and the server
	 * renders exactly what the address bar asks for rather than a January that an effect corrects
	 * after hydration.
	 *
	 * A query string rather than `/kalender/2026-09`, because `/kalender/<dato>` is already the day
	 * page and two dynamic segments under one directory could not tell a month from a day without
	 * a matcher that exists only to disambiguate our own URLs.
	 */
	const range = await calendarRange();

	/**
	 * The rail is fetched once, at the top, because it does not depend on the view.
	 *
	 * It shows the same half-year whichever month or week you are looking at — that is what makes
	 * it a place to navigate *from*. Re-fetching it per month would be a query per arrow press for
	 * an answer that never changed.
	 */
	const horizon = await horizonWeeks();

	/*
	 * `?veke=` decides the view. Present and real → the week; otherwise the month.
	 *
	 * A malformed or invented week (`2025-W53` — there is no such week) falls back to the month
	 * rather than erroring, the same treatment `?maanad=tull` and `?kategori=finnesikkje` get. The
	 * URL is hand-editable and a reader who mistypes one deserves the calendar, not a 500.
	 */
	const activeWeek = $derived.by((): string | null => {
		const raw = page.url.searchParams.get('veke');
		return raw && isIsoWeek(raw) ? raw : null;
	});

	/*
	 * An unparseable or out-of-range month falls back to the current one rather than erroring.
	 *
	 * Clamping to the range also means the arrows can never hand out a URL that this page then
	 * refuses. When a week is being shown, the month follows it — so switching views lands you
	 * where you were rather than back in today.
	 */
	const month = $derived.by((): string => {
		// The week's Thursday, because that is the month a straddling week belongs to — the same
		// rule that decides its ISO year.
		if (activeWeek) return clamp(monthKeyOf(addDays(isoWeekStart(activeWeek), 3)));
		const raw = page.url.searchParams.get('maanad');
		if (!raw || !isMonthKey(raw)) return range.current;
		return clamp(raw);
	});

	function clamp(monthKey: string): string {
		if (monthKey < range.first) return range.first;
		if (monthKey > range.last) return range.last;
		return monthKey;
	}

	/**
	 * The month view is a stack you scroll, not a page you step through.
	 *
	 * Arrows made "what about the week after next" a question you answered by leaving the page and
	 * coming back to a different one, having lost your place. Months below each other answer it by
	 * scrolling — which is what a wall calendar does, and what the rail above already implies by
	 * showing half a year at once.
	 *
	 * Six of them, because that is what the rail covers: a page that stacked all twenty-three
	 * months this database holds would render sixty grids to show you two. Anything further out is
	 * a link at the foot, which starts a new stack there.
	 */
	const STACK_MONTHS = 6;

	/*
	 * Always six, even where we hold nothing yet.
	 *
	 * Clipping the stack to the last month with data was the first attempt, and on a database
	 * holding only the current month it rendered exactly one grid — so "scroll down for next
	 * month" silently stopped being a thing the page did. An empty October is a true answer and a
	 * working affordance; a missing October is neither. What we do and do not cover is the rail's
	 * job to say, and it says it.
	 */
	const stack = $derived(Array.from({ length: STACK_MONTHS }, (_, i) => shiftMonth(month, i)));
	const spanFrom = $derived(stack[0] ?? month);
	const spanTo = $derived(stack.at(-1) ?? month);

	/*
	 * Derived and awaited in the markup, not a top-level await.
	 *
	 * A top-level `await dayCounts(...)` captures the span once, so the grids would never change
	 * when you followed a month link. Awaiting the derived promise in the template keeps the
	 * dependency live and still suspends the component on the server, so every month is
	 * server-rendered — which matters on a page whose whole job is to be crawlable by date.
	 *
	 * One query for the whole stack rather than one per grid: six round trips reading overlapping
	 * windows of the same table, to render one screenful, is a cost nobody has to pay.
	 */
	const counts = $derived(dayCounts({ from: spanFrom, to: spanTo }));
	const places = $derived(placeCounts({ from: spanFrom, to: spanTo }));

	/** The stack before this one, and the one after. Absent at the ends of what we hold. */
	const earlier = $derived(
		month > range.first
			? (() => {
					const back = shiftMonth(month, -STACK_MONTHS);
					return back < range.first ? range.first : back;
				})()
			: null
	);
	/* Only when there is actually something past the stack — an empty stack of empty months is
	   not an invitation. */
	const later = $derived(spanTo < range.last ? shiftMonth(spanTo, 1) : null);
	const monthName = $derived(formatMonthName(month));

	/** How much a single month of the shared count list holds. */
	function monthTotal(all: { date: string; total: number }[], key: string): number {
		return all.reduce((n, c) => (c.date.startsWith(key) ? n + c.total : n), 0);
	}

	/**
	 * Weeks are bounded by the same data the months are, so neither set of arrows can walk you off
	 * the end of what we hold. Compared as dates rather than as week keys: a week straddling
	 * December belongs to two months and only its days can say whether it is in range.
	 */
	const firstDate = $derived(monthBounds(range.first).first);
	const lastDate = $derived(monthBounds(range.last).last);
	const previousWeek = $derived.by((): string | null => {
		if (!activeWeek) return null;
		const candidate = shiftWeek(activeWeek, -1);
		return addDays(isoWeekStart(candidate), 6) >= firstDate ? candidate : null;
	});
	const nextWeek = $derived.by((): string | null => {
		if (!activeWeek) return null;
		const candidate = shiftWeek(activeWeek, 1);
		return isoWeekStart(candidate) <= lastDate ? candidate : null;
	});

	/**
	 * Where each view switch goes.
	 *
	 * Switching keeps your place: month → week lands on the current week when you are looking at
	 * the current month, and on the month's first week otherwise. Dropping the reader into today
	 * whenever they changed view would make the switch feel like a reset.
	 */
	const weekHref = $derived(
		activeWeek ??
			(month === range.current ? isoWeekKey(range.today) : isoWeekKey(monthBounds(month).first))
	);
</script>

<svelte:head>
	{#if activeWeek}
		<title>{formatWeekName(activeWeek)} — kalender — hendingar.no</title>
		<meta
			name="description"
			content="Hendingar i Sunnhordland {formatWeekRange(activeWeek).toLowerCase()}, time for time."
		/>
	{:else}
		<title>{monthName} og framover — kalender — hendingar.no</title>
		<meta
			name="description"
			content="Kalender over hendingar i Sunnhordland frå {monthName}. Tal på hendingar per dag, månad for månad — trykk på ein dag for å sjå kva som skjer."
		/>
	{/if}
</svelte:head>

<div class="shell cal-page">
	<p class="label">Sunnhordland</p>
	<h1 class="display cal-page__h">Kalender</h1>
	<p class="cal-page__lead">
		Kor mykje som skjer, dag for dag. Trykk på ein dag for å sjå kva det er.
	</p>

	<!-- The rail is above the views because it is what you navigate *with*: it is the only thing on
	     the page that shows more than one month, and every bar is a way into a week. -->
	<HorizonRail
		weeks={horizon.weeks}
		total={horizon.total}
		horizonEnd={horizon.horizonEnd}
		currentWeek={horizon.currentWeek}
		{activeWeek}
	/>

	<div class="cal-page__bar">
		<!-- Links, not buttons: each view is a real location, and aria-current marks the active one
		     so it is not signalled by colour alone. -->
		<nav class="views" aria-label="Vising">
			<a
				class="chip"
				href="/kalender?maanad={month}"
				aria-current={activeWeek ? undefined : 'page'}
			>
				Månad
			</a>
			<a
				class="chip"
				href="/kalender?veke={weekHref}"
				aria-current={activeWeek ? 'page' : undefined}
			>
				Veke
			</a>
		</nav>

		{#if activeWeek}
			<nav class="steps" aria-label="Bytt veke">
				<!--
					An arrow only exists when there is a week behind it. Rendering a disabled control at
					the edge of the data would be a button that says "there is more this way" and then
					refuses — the placeholder keeps the name centred either way.

					The month view has no stepper at all any more: its months are stacked and you scroll.
				-->
				{#if previousWeek}
					<a
						class="steps__step"
						href="/kalender?veke={previousWeek}"
						rel="prev"
						aria-label="Førre veke: {formatWeekName(previousWeek)}"
					>
						<span class="steps__arrow" aria-hidden="true">←</span>
						<span class="steps__label">{formatWeekName(previousWeek)}</span>
					</a>
				{:else}
					<span class="steps__step steps__step--none" aria-hidden="true"></span>
				{/if}

				<h2 class="display display--md steps__now">
					{formatWeekName(activeWeek)}
					<span class="steps__range">{formatWeekRange(activeWeek)}</span>
				</h2>

				{#if nextWeek}
					<a
						class="steps__step steps__step--next"
						href="/kalender?veke={nextWeek}"
						rel="next"
						aria-label="Neste veke: {formatWeekName(nextWeek)}"
					>
						<span class="steps__label">{formatWeekName(nextWeek)}</span>
						<span class="steps__arrow" aria-hidden="true">→</span>
					</a>
				{:else}
					<span class="steps__step steps__step--none" aria-hidden="true"></span>
				{/if}
			</nav>
		{/if}
	</div>

	{#if activeWeek}
		{@const week = await weekEvents(activeWeek)}
		{#if week.timed.length === 0 && week.spanning.length === 0}
			<p class="cal-page__empty">
				Ingenting registrert denne veka. <a href="/kalender?maanad={month}">Sjå heile månaden</a>
				eller
				<a href="/send-inn">send inn ei hending</a>.
			</p>
		{:else}
			<WeekGrid dates={week.dates} timed={week.timed} spanning={week.spanning} today={week.today} />
		{/if}
	{:else}
		{@const all = await counts}

		<Hotspots from={spanFrom} to={spanTo} counts={all} places={await places} today={range.today} />

		{#if earlier}
			<p class="months__step">
				<a href="/kalender?maanad={earlier}" rel="prev">
					<span aria-hidden="true">↑</span> Tidlegare månader
				</a>
			</p>
		{/if}

		<!--
			Months below each other, each its own labelled region so the date is part of the document
			structure rather than a visual break a screen reader cannot perceive.
		-->
		{#each stack as key (key)}
			<section class="month" id="maanad-{key}" aria-labelledby="h-{key}">
				<h2 class="display display--md month__h" id="h-{key}">
					{formatMonthName(key)}
					<span class="month__n">
						{#if monthTotal(all, key) === 0}
							Ingenting registrert enno
						{:else}
							{monthTotal(all, key)}
							{monthTotal(all, key) === 1 ? 'hending' : 'hendingar'}
						{/if}
					</span>
				</h2>
				<!-- Sliced from the one query the whole stack shares. Each grid still decides its own
				     hotspots from its own month, so a quiet March is not judged against a busy May. -->
				<MonthGrid
					monthKey={key}
					counts={all.filter((c) => c.date.startsWith(key))}
					today={range.today}
				/>
			</section>
		{/each}

		{#if later}
			<p class="months__step months__step--later">
				<a href="/kalender?maanad={later}" rel="next">
					Fleire månader <span aria-hidden="true">↓</span>
				</a>
			</p>
		{/if}
	{/if}

	<p class="cal-page__foot">
		{#if month !== range.current || activeWeek}
			<a href="/kalender">Tilbake til {formatMonthName(range.current)}</a> ·
		{/if}
		<a href="/hendingar">Sjå heile lista</a> ·
		<a href="/send-inn">Send inn ei hending</a>
	</p>
</div>

<style>
	.cal-page {
		padding-block: clamp(2rem, 5vw, 4rem) var(--section-y);
		container-type: inline-size;
	}
	.cal-page__h {
		/* cqw, never vw: sized against this column so it survives 320px and does not overflow on a
		   wide desktop. */
		font-size: clamp(1.75rem, 11cqw, 5rem);
		margin-block: 0.4rem 0.6rem;
	}
	.cal-page__lead {
		max-inline-size: 48ch;
		color: var(--peach-dim);
		margin-block: 0 clamp(1.5rem, 3vw, 2.5rem);
	}
	.cal-page__empty {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: var(--step-mid);
		max-inline-size: 34ch;
	}

	/*
	 * A stacked month, and the heading that stays with it.
	 *
	 * Sticky because the whole point of stacking is that you scroll past the month you started in;
	 * without it, "which month am I looking at" becomes the question the page stops answering
	 * halfway down. The same reasoning already makes day headings sticky on a narrow listing.
	 *
	 * It needs a solid background: the grid passes underneath, and a transparent heading over a
	 * row of squares is unreadable.
	 */
	.month + .month {
		margin-block-start: clamp(2rem, 4vw, 3rem);
	}
	.month__h {
		position: sticky;
		inset-block-start: 0;
		z-index: 3;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem 0.9rem;
		font-size: clamp(1.1rem, 5cqw, 2rem);
		background: var(--navy-800);
		margin-block: 0 0.75rem;
		padding-block: 0.5rem 0.45rem;
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.month__n {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}

	/* The stack has ends, and they are links rather than dead space. */
	.months__step {
		margin-block: clamp(1rem, 2vw, 1.5rem);
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}
	.months__step a {
		text-decoration: none;
		border-block-end: var(--rule) solid var(--peach-line);
		padding-block-end: 0.2em;
	}
	.months__step a:hover {
		border-color: var(--peach);
	}
	.months__step--later {
		text-align: center;
	}

	.cal-page__bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1.5rem;
		margin-block-end: 1rem;
	}
	.views {
		display: flex;
		gap: 0.4rem;
	}

	.steps {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		/* Takes the rest of the row on a wide screen and the whole of the next one on a phone, so
		   the month name stays centred between its arrows at both ends. */
		flex: 1 1 20rem;
	}
	.steps__now {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: center;
		gap: 0.2rem 0.6rem;
		font-size: clamp(1.1rem, 5cqw, 2rem);
		text-align: center;
		flex: 1;
	}
	.steps__range {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: none;
		color: var(--peach-dim);
	}
	.steps .steps__step {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--peach-dim);
		flex: 0 1 auto;
		min-inline-size: 1.5rem;
	}
	.steps .steps__step:hover {
		color: var(--peach-hi);
	}
	.steps .steps__step--next {
		text-align: end;
	}
	.steps .steps__arrow {
		font-size: var(--step-body);
	}

	/*
	 * On a phone the neighbouring names cost more room than they earn — three of them across 320px
	 * wraps the row and pushes the grid below the fold. The arrows stay, and the links keep their
	 * full names through aria-label.
	 */
	@media (width < 34rem) {
		.steps .steps__label {
			display: none;
		}
		.steps__range {
			inline-size: 100%;
		}
	}

	.cal-page__foot {
		margin-block-start: clamp(1.5rem, 3vw, 2.5rem);
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.08em;
		color: var(--peach-dim);
	}
</style>
