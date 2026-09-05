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
		monthEventCounts,
		monthPlaces,
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

	/*
	 * Derived and awaited in the markup, not a top-level await.
	 *
	 * A top-level `await monthEventCounts(month)` captures the month once, so the grid would never
	 * change when you pressed an arrow. Awaiting the derived promise in the template keeps the
	 * dependency live and still suspends the component on the server, so every month is
	 * server-rendered — which matters on a page whose whole job is to be crawlable by date.
	 */
	const counts = $derived(monthEventCounts(month));
	const places = $derived(monthPlaces(month));

	const previousMonth = $derived(month > range.first ? shiftMonth(month, -1) : null);
	const nextMonth = $derived(month < range.last ? shiftMonth(month, 1) : null);
	const monthName = $derived(formatMonthName(month));

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
		<title>{monthName} — kalender — hendingar.no</title>
		<meta
			name="description"
			content="Kalender over hendingar i Sunnhordland i {monthName}. Tal på hendingar per dag — trykk på ein dag for å sjå kva som skjer."
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

		<nav class="steps" aria-label={activeWeek ? 'Bytt veke' : 'Bytt månad'}>
			<!--
				An arrow only exists when there is a month or a week behind it. Rendering a disabled
				control at the edge of the data would be a button that says "there is more this way"
				and then refuses — the placeholder keeps the name centred either way.
			-->
			{#if activeWeek}
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
			{:else}
				{#if previousMonth}
					<a
						class="steps__step"
						href="/kalender?maanad={previousMonth}"
						rel="prev"
						aria-label="Førre månad: {formatMonthName(previousMonth)}"
					>
						<span class="steps__arrow" aria-hidden="true">←</span>
						<span class="steps__label">{formatMonthName(previousMonth)}</span>
					</a>
				{:else}
					<span class="steps__step steps__step--none" aria-hidden="true"></span>
				{/if}

				<h2 class="display display--md steps__now">{monthName}</h2>

				{#if nextMonth}
					<a
						class="steps__step steps__step--next"
						href="/kalender?maanad={nextMonth}"
						rel="next"
						aria-label="Neste månad: {formatMonthName(nextMonth)}"
					>
						<span class="steps__label">{formatMonthName(nextMonth)}</span>
						<span class="steps__arrow" aria-hidden="true">→</span>
					</a>
				{:else}
					<span class="steps__step steps__step--none" aria-hidden="true"></span>
				{/if}
			{/if}
		</nav>
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
		<MonthGrid monthKey={month} counts={await counts} today={range.today} />
		<Hotspots monthKey={month} counts={await counts} places={await places} today={range.today} />
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
