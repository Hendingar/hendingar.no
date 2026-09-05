<script lang="ts">
	import {
		MONTH_NAMES,
		WEEKDAY_ABBR,
		WEEKDAY_NAMES,
		formatMonthName
	} from '@hendingar/core/datetime';
	import { densityStep, hotspotFloor, monthGrid, pipCount } from '../../calendar.ts';
	import type { DayCount } from '../../events.remote';

	/**
	 * One month as a table of dates, each carrying how many events fall on it.
	 *
	 * A month grid *is* a table — seven columns named by weekday, rows that are weeks — so it is
	 * marked up as one rather than as a div grid with `role="grid"` bolted on. That buys the column
	 * headers, the caption, and row/column navigation in a screen reader for free, and it is what
	 * the content actually is.
	 *
	 * Keyboard navigation is the links themselves, in reading order: tab moves day to day, enter
	 * opens one. The roving-tabindex arrow-key pattern was considered and dropped — it takes the
	 * days out of the tab order, so a reader who expects tab to work finds a grid they cannot
	 * reach, and it only pays for itself on a date picker with 400 focusable cells.
	 *
	 * ## A count, said three ways
	 *
	 * The numeral alone made the grid a thing to read square by square: "how busy is the second
	 * half of March" needed thirty separate readings and a memory. So a square also carries a
	 * **fill** whose strength tracks its count, and a row of **pips**. The redundancy is the point:
	 * colour alone fails WCAG 1.4.1 and anyone reading in grayscale, adjacent fill steps are hard
	 * to tell apart in isolation, and the pips give the shape of a month at a glance without being
	 * counted. The exact figure stays in the numeral and in every day link's accessible name.
	 *
	 * The date is the display numeral and the count is the small mono one, not the other way round.
	 * You arrive at a calendar looking for a date.
	 */
	let {
		monthKey,
		counts,
		today
	}: {
		monthKey: string;
		counts: DayCount[];
		/** The site's today, `YYYY-MM-DD`, resolved server-side so SSR and hydration agree. */
		today: string;
	} = $props();

	const weeks = $derived(monthGrid(monthKey));
	const byDate = $derived(new Map(counts.map((c) => [c.date, c.total])));
	const monthName = $derived(MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1] ?? '');

	/**
	 * What counts as a hotspot *in this month*.
	 *
	 * Computed from the month on screen rather than fixed, because the busiest days of a quiet
	 * February are still worth finding — but with a floor, so a month whose peak is two events
	 * marks nothing rather than promoting its least-quiet Tuesday. See `hotspotFloor`.
	 */
	const floor = $derived(hotspotFloor(counts.map((c) => c.total)));

	/**
	 * The link's accessible name, spelled out.
	 *
	 * A cell reading "12" and "3" gives a screen reader "12 3", which is a phone number. Naming the
	 * link in full means the day makes sense read out of context — which is exactly how a link is
	 * encountered when someone tabs to it or lists the page's links. The hotspot and today marks
	 * are said here too: neither may exist only as a colour.
	 */
	function dayLabel(date: string, day: number, total: number): string {
		const events = total === 1 ? '1 hending' : `${total} hendingar`;
		const marks = [date === today ? 'i dag' : null, total >= floor ? 'ein av dei travlaste' : null]
			.filter(Boolean)
			.join(', ');
		return `${day}. ${monthName}, ${events}${marks ? ` — ${marks}` : ''}`;
	}
</script>

<table class="cal">
	<caption class="visually-hidden">
		Hendingar i {formatMonthName(monthKey)}, ei rad per veke
	</caption>
	<thead>
		<tr>
			{#each WEEKDAY_ABBR as abbr, i (abbr)}
				<th scope="col">
					<span aria-hidden="true">{abbr}</span>
					<!-- The visible header is two letters so seven columns fit a 320px screen; the
					     full weekday is what a screen reader announces for the column. -->
					<span class="visually-hidden">{WEEKDAY_NAMES[i]}</span>
				</th>
			{/each}
		</tr>
	</thead>
	<tbody>
		{#each weeks as week, w (w)}
			<tr>
				{#each week as cell, c (cell ? cell.date : `pad-${w}-${c}`)}
					{#if cell === null}
						<!-- A square belonging to the month either side. Left empty on purpose: filling it
						     in would invite a tap that silently changes month. -->
						<td class="cal__pad"></td>
					{:else}
						{@const total = byDate.get(cell.date) ?? 0}
						{@const hot = total >= floor}
						<td
							class="cal__cell"
							class:cal__cell--past={cell.date < today}
							data-density={densityStep(total)}
							aria-current={cell.date === today ? 'date' : undefined}
						>
							{#if total > 0}
								<a
									class="cal__day"
									href="/kalender/{cell.date}"
									aria-label={dayLabel(cell.date, cell.day, total)}
								>
									<span class="cal__top">
										<span class="cal__n display display--md">{cell.day}</span>
										<span class="cal__count" class:cal__count--hot={hot}>{total}</span>
									</span>
									<!-- Decorative: the figure is already in the link's name, and pips are a
									     shape to recognise rather than a thing to count. -->
									<span class="cal__pips" aria-hidden="true">
										{#each { length: pipCount(total) }, p (p)}
											<span class="cal__pip"></span>
										{/each}
									</span>
								</a>
							{:else}
								<!--
									An empty day is a number and nothing else.

									Not a link: a square that leads to a page saying "ingen hendingar" is a worse
									control than one that never invited the tap — the same reasoning that keeps a
									zero-count category chip off /hendingar. The date is still reachable by URL.
								-->
								<span class="cal__day cal__day--empty">
									<span class="cal__top">
										<span class="cal__n display display--md">{cell.day}</span>
									</span>
								</span>
							{/if}
						</td>
					{/if}
				{/each}
			</tr>
		{/each}
	</tbody>
</table>

<style>
	/*
	 * Every selector here is a class on a wrapper, never a bare `td` or `th`.
	 *
	 * Svelte compiles `td { … }` to `td.svelte-hash`, specificity (0,1,1), which outranks the
	 * single-class utilities in brand.css — `.visually-hidden` among them, which this component
	 * relies on inside its own cells.
	 */
	.cal {
		inline-size: 100%;
		border-collapse: collapse;
		table-layout: fixed;
		/* Display type inside the cells is sized against this container, never the viewport. */
		container-type: inline-size;
	}

	.cal th {
		padding-block: 0 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--peach-dim);
		text-align: start;
		border-block-end: var(--rule) solid var(--peach-line);
	}

	.cal td {
		padding: 0;
		border: var(--rule) solid var(--peach-line);
		vertical-align: top;
	}

	/* A padding square is not a day. No border, so the month reads as its own shape. */
	.cal .cal__pad {
		border-color: transparent;
	}

	/*
	 * The density scale. The steps and the reason the top one is 22% live in brand.css beside the
	 * other alpha tokens, which is where the next person measuring a wash will look for them.
	 */
	.cal [data-density='1'] {
		background: var(--peach-wash-1);
	}
	.cal [data-density='2'] {
		background: var(--peach-wash-2);
	}
	.cal [data-density='3'] {
		background: var(--peach-wash-3);
	}
	.cal [data-density='4'] {
		background: var(--peach-wash-4);
	}

	.cal .cal__day {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 0.35rem;
		/*
		 * Sized against the table, not the viewport — the `cqw` rule again, and for the same
		 * reason. `aspect-ratio: 1` was the obvious first answer and made every desktop square
		 * 170px tall: a month became 900px of mostly empty ink and the last week fell below the
		 * fold. A floor keeps a phone's squares tappable, the ceiling keeps a wide screen sane.
		 */
		min-block-size: clamp(2.75rem, 8cqw, 6rem);
		padding: 0.35rem 0.4rem 0.3rem;
		text-decoration: none;
	}

	.cal .cal__top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.3rem;
	}

	/* The date is what you scan for, so it gets the display face. */
	.cal .cal__n {
		font-size: clamp(0.95rem, 3.4cqw, 1.75rem);
		color: var(--peach);
	}

	/* An empty day is dimmer and inert. Its number is still legible — peach-dim is AA everywhere. */
	.cal .cal__day--empty .cal__n {
		color: var(--peach-dim);
		opacity: 0.7;
	}

	.cal .cal__count {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--peach-dim);
	}

	/*
	 * A hotspot inverts its count rather than deepening the square.
	 *
	 * navy-900 on peach is 8.29:1, and it is the same chip the tiles use for a start time — so the
	 * grid borrows a mark the rest of the site has already taught. It is never the only signal:
	 * the day link's accessible name says "ein av dei travlaste" too.
	 */
	.cal .cal__count--hot {
		background: var(--peach);
		color: var(--navy-900);
		padding: 0.15em 0.4em;
		letter-spacing: 0.16em;
	}

	.cal .cal__pips {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 2px;
		align-items: end;
	}
	.cal .cal__pip {
		display: block;
		block-size: 3px;
		background: var(--peach);
		opacity: 0.85;
	}

	/*
	 * A day that has been is still a day, and still has a page.
	 *
	 * The calendar deliberately shows the past — blanking out the first half of the month would
	 * make the site look like it has no history while those day pages still worked. But the reader
	 * is almost always looking forward, so the past is stated rather than emphasised: the date
	 * drops to peach-dim, which is AA on every surface here, and the fill stays exactly as strong
	 * as the count earns. Dimming the fill too would make the density scale mean two things.
	 */
	.cal .cal__cell--past .cal__n {
		color: var(--peach-dim);
	}
	.cal .cal__cell--past .cal__pip {
		opacity: 0.5;
	}

	.cal .cal__day:hover {
		background: var(--peach-ghost);
	}
	.cal .cal__day:hover .cal__n {
		color: var(--peach-hi);
	}

	/*
	 * Today, marked by a border rather than by colour alone.
	 *
	 * `aria-current="date"` carries it for a screen reader, the fat rule carries it for everyone
	 * else, and the day link's own accessible name ends "— i dag" so it is not only a visual state.
	 */
	.cal td[aria-current='date'] {
		border: var(--rule-fat) solid var(--peach);
	}

	/*
	 * The pip row is the first thing to go when a square gets small: at 320px a cell is about 40px
	 * wide and six pips inside it are three grey smudges. The fill and the numeral both still work.
	 */
	@container (width < 22rem) {
		.cal .cal__pips {
			display: none;
		}
	}
</style>
