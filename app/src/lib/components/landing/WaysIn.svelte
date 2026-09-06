<script lang="ts">
	import { waysInCounts } from '../../events.remote';

	/**
	 * The four ways into the list, each carrying how much is behind it.
	 *
	 * This is the front page's primary control, and every one of the four is a LINK to a page that
	 * already exists — `/kalender/<dato>` twice, `/neste-helg`, `/hendingar`. Not a filter that
	 * swaps the list in place. That is the reasoning recorded in #81 when the weekend tab was built
	 * as a route rather than a query parameter: a filter has to be a URL to be shareable, and a URL
	 * that answers a different question every Monday is not a filter, it is a page. Buttons holding
	 * client state would also have shipped an empty control to every crawler and to anyone without
	 * JavaScript, on the one row of the site that is meant to move people onward.
	 *
	 * The counts are what make them worth pressing. "I dag" is a label; "I dag / 6 hendingar" is a
	 * reason — and it means nobody arrives at an empty page, because the number told them first.
	 *
	 * Top-level await, so all four are in the server-rendered HTML (CLAUDE.md).
	 */
	const counts = await waysInCounts();

	// A day with nothing on it still gets its tile, greyed rather than hidden. "Ingenting i dag" is
	// an answer; a control that vanishes on quiet days is a page that changes shape for no reason
	// the reader can see, and it would take the row from four tiles to two on a Tuesday.
	const ways = $derived([
		{ href: `/kalender/${counts.today}`, label: 'I dag', n: counts.todayCount },
		{ href: `/kalender/${counts.tomorrow}`, label: 'I morgon', n: counts.tomorrowCount },
		{ href: '/neste-helg', label: 'Neste helg', n: counts.weekendCount },
		{ href: '/hendingar', label: 'Alt framover', n: counts.upcomingCount }
	]);
</script>

<nav class="ways" aria-label="Når">
	<ul>
		{#each ways as way (way.href)}
			<li>
				<a class="ways__a" class:ways__a--empty={way.n === 0} href={way.href}>
					<span class="ways__t">{way.label}</span>
					<span class="ways__n">
						{way.n}
						{way.n === 1 ? 'hending' : 'hendingar'}
					</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.ways ul {
		display: grid;
		/*
		 * Two across even at 320px, four on a wide screen — never one, and never three.
		 *
		 * Measured on a phone: stacked one per row, the four tiles are 350px of chrome, and with
		 * the heading above them the first event fell off the bottom of a 390×844 screen entirely.
		 * On the page whose whole argument is "events first", the control that leads to the events
		 * had pushed them out of sight. Two columns halves it and still clears the 44px target with
		 * room to spare. Three is never right — it leaves a widow on its own row.
		 */
		grid-template-columns: repeat(2, minmax(0, 1fr));
		list-style: none;
		margin: 0;
		padding: 0;
		border-block-start: var(--rule) solid var(--peach-line);
	}
	@media (width >= 60rem) {
		.ways ul {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.ways li {
		display: grid;
		min-inline-size: 0;
	}

	.ways__a {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.5rem;
		/* Comfortably past the 44px floor — this is the row the page is built to have pressed. */
		min-block-size: 4.75rem;
		padding: 0.9rem clamp(0.75rem, 3vw, 1.25rem);
		text-decoration: none;
		color: var(--peach-dim);
		border-block-end: var(--rule) solid var(--peach-line);
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease;
	}
	/*
	 * The dividing hairline belongs to the cell, so it never depends on which child is first.
	 * `border-inline-start` on all but the first would break the moment the row wraps to two
	 * columns, where the "first" tile of the second row is not the first child.
	 */
	.ways__a {
		border-inline-start: var(--rule) solid var(--peach-line);
	}
	.ways li:nth-child(odd) .ways__a {
		border-inline-start: 0;
	}
	@media (width >= 60rem) {
		.ways li:nth-child(odd) .ways__a {
			border-inline-start: var(--rule) solid var(--peach-line);
		}
		.ways li:first-child .ways__a {
			border-inline-start: 0;
		}
	}

	.ways__a:hover {
		background: var(--peach-ghost);
		color: var(--peach);
	}

	.ways__t {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: clamp(1.15rem, 2.4vw, 1.45rem);
		line-height: 1;
		letter-spacing: -0.01em;
		text-transform: uppercase;
		color: var(--peach);
	}
	.ways__n {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		font-variant-numeric: tabular-nums;
	}

	/*
	 * Nothing on: still a link, still says so.
	 *
	 * `--peach-dim`, not `--peach-quiet` — brand.css marks quiet as large display numerals only at
	 * 3.1:1, and this is small text that has to be read.
	 */
	.ways__a--empty .ways__t {
		color: var(--peach-dim);
	}
</style>
