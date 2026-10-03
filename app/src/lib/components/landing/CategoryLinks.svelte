<script lang="ts">
	import { listCategoryCounts } from '../../events.remote';

	/**
	 * What kind of thing, as links into the filtered listing.
	 *
	 * `/hendingar?kategori=<slug>` already exists and is already the way the full list filters, so
	 * these are the same URLs that page's own chips produce — one filter, one address, reachable a
	 * screen earlier. Nothing here holds state.
	 *
	 * `listCategoryCounts` returns only categories that HAVE something, ordered by how much, and
	 * the note on it records why: a chip leading to an empty page is a worse control than one that
	 * tells you what it holds before you press it.
	 *
	 * Top-level await, so the row is in the server-rendered HTML — these are internal links, and a
	 * crawler that cannot see them cannot find the filtered pages.
	 */
	const counts = await listCategoryCounts();
</script>

{#if counts.length > 0}
	<!--
		The shell is the wrapper, NOT the list.

		The list is a horizontal scroller on a phone and cancels the gutter with a negative margin
		so the chips reach the edge of the screen. With `.shell` on the list itself that margin had
		nothing to cancel — it simply made the element two gutters wider than the viewport, and the
		page scrolled sideways by exactly 20px at both 390 and 320. One `<div>` fixes it.
	-->
	<nav class="cats" aria-label="Kategoriar">
		<div class="shell">
			<ul>
				{#each counts as category (category.slug)}
					<li>
						<a class="chip" href={`/hendingar?kategori=${category.slug}`}>
							{category.label}<span class="chip__n">{category.total}</span>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	</nav>
{/if}

<style>
	.cats {
		padding-block: clamp(0.75rem, 1.5vw, 1rem);
	}
	/*
	 * One scrolling row at every width.
	 *
	 * Seventeen categories wrap to six rows at 390px — about 250px of chrome directly above the
	 * events — and even on a desktop they took two rows, a wall of uppercase to read past before
	 * the first event. One row says "there are kinds, and here are the biggest" and lets the rest
	 * run off the edge. The same treatment /hendingar gives its filter row, down to the negative
	 * margin that lets the chips run to the edge of the screen rather than stopping at the gutter.
	 */
	.cats ul {
		display: flex;
		gap: 0.5rem;
		list-style: none;
		margin: 0;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scroll-snap-type: x proximity;
		/* Without this, snapping aligns the first chip to the scroller's edge — which the negative
		   margin put at the screen edge — and the row loads already scrolled past the gutter. */
		scroll-padding-inline: var(--gutter, 1rem);
		margin-inline: calc(var(--gutter, 1rem) * -1);
		padding-inline: var(--gutter, 1rem);
		/* The row is the scroller; hiding its bar keeps it from reading as a broken layout.
		   Scrolling stays discoverable because the chips visibly run off the edge. */
		scrollbar-width: none;
	}
	.cats ul::-webkit-scrollbar {
		display: none;
	}
	.cats li {
		flex: none;
		scroll-snap-align: start;
	}

	/*
	 * Not `.chip` from a route's <style>.
	 *
	 * /hendingar has a chip of its own, scoped inside that page, so this is deliberately a second
	 * declaration rather than a shared one — and that is the smell CLAUDE.md names. Left here on
	 * purpose for now: that one is a filter control carrying `aria-current`, this one is plain
	 * navigation, and hoisting a single primitive that has to serve both belongs in a change that
	 * touches both files rather than smuggled into this one.
	 */
	.chip {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4em;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--peach-dim);
		border: var(--rule) solid var(--peach-line);
		/* 0.75em block padding puts the target just over 44px at the 12px micro step. */
		padding: 0.75em 0.9em;
		transition:
			color var(--dur-fast) ease,
			border-color var(--dur-fast) ease;
	}
	.chip:hover {
		color: var(--peach-hi);
		border-color: var(--peach);
	}
	.chip__n {
		font-weight: 400;
		opacity: 0.72;
		font-variant-numeric: tabular-nums;
	}
</style>
