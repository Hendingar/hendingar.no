<script lang="ts">
	import {
		MONTH_NAMES,
		WEEKDAY_ABBR,
		WEEKDAY_NAMES,
		formatMonthName
	} from '@hendingar/core/datetime';
	import { monthGrid } from '../../calendar.ts';
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
	 * The link's accessible name, spelled out.
	 *
	 * A cell reading "12" and "3" gives a screen reader "12 3", which is a phone number. Naming the
	 * link in full means the day makes sense read out of context — which is exactly how a link is
	 * encountered when someone tabs to it or lists the page's links.
	 */
	function dayLabel(date: string, day: number, total: number): string {
		const events = total === 1 ? '1 hending' : `${total} hendingar`;
		return `${day}. ${monthName}, ${events}${date === today ? ' — i dag' : ''}`;
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
					{:else if (byDate.get(cell.date) ?? 0) > 0}
						<td class="cal__cell" aria-current={cell.date === today ? 'date' : undefined}>
							<a
								class="cal__day"
								href="/kalender/{cell.date}"
								aria-label={dayLabel(cell.date, cell.day, byDate.get(cell.date) ?? 0)}
							>
								<span class="cal__n">{cell.day}</span>
								<span class="cal__count">{byDate.get(cell.date)}</span>
							</a>
						</td>
					{:else}
						<!--
							An empty day is a number and nothing else.

							Not a link: a square that leads to a page saying "ingen hendingar" is a worse
							control than one that never invited the tap — the same reasoning that keeps a
							zero-count category chip off /hendingar. The date is still reachable by URL.
						-->
						<td class="cal__cell" aria-current={cell.date === today ? 'date' : undefined}>
							<span class="cal__day cal__day--empty">
								<span class="cal__n">{cell.day}</span>
							</span>
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

	.cal .cal__day {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 0.25rem;
		/*
		 * Sized against the table, not the viewport — the `cqw` rule again, and for the same
		 * reason. `aspect-ratio: 1` was the obvious first answer and made every desktop square
		 * 170px tall: a month became 900px of mostly empty ink and the last week fell below the
		 * fold. A floor keeps a phone's squares tappable, the ceiling keeps a wide screen sane.
		 */
		min-block-size: clamp(2.75rem, 8cqw, 6rem);
		padding: 0.35rem 0.4rem;
		text-decoration: none;
	}

	.cal .cal__n {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}

	/* An empty day is dimmer and inert. Its number is still legible — peach-dim is AA everywhere. */
	.cal .cal__day--empty .cal__n {
		opacity: 0.55;
	}

	/*
	 * The count is the only display type on the page that is genuinely a numeral, so it gets the
	 * poster treatment: big, wide, and sized in cqw against the table.
	 */
	.cal .cal__count {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 125%;
		line-height: 0.82;
		font-size: clamp(1rem, 4cqw, 2.25rem);
		color: var(--peach);
	}

	.cal .cal__day:hover {
		background: var(--peach-ghost);
	}
	.cal .cal__day:hover .cal__count {
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
</style>
