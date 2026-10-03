<script lang="ts">
	import { formatEventTime } from '@hendingar/core/datetime';
	import { siteStatus } from '../../events.remote';
	import WaysIn from './WaysIn.svelte';

	/**
	 * The top of the page: the question, one line that answers "is this worth using", and the
	 * ways in.
	 *
	 * This replaced a full-height hero — a giant HENDINGAR wordmark, a halftone illustration, a
	 * lede and a paragraph about us. All of it was true and none of it was what a visitor came for.
	 * The wordmark is already in the masthead on every page, so the most valuable space on the site
	 * was spent saying the site's name a second time.
	 *
	 * The source count does the job the manifest band used to do, and does it better, because it is
	 * read from the data rather than written as copy. "19 kjelder" is a claim that cannot rot;
	 * "Vi samlar alt" is one that can. Same reasoning as `CoverageStatus`, one screen higher.
	 *
	 * Top-level await, so this is in the server-rendered HTML.
	 */
	const status = await siteStatus();

	const where = $derived(
		status.regions.length === 0
			? 'Sunnhordland'
			: status.regions.length === 1
				? status.regions[0]
				: `${status.regions.slice(0, -1).join(', ')} og ${status.regions.at(-1)}`
	);
</script>

<header class="ask">
	<div class="shell">
		<div class="ask__top">
			<!--
				The h1 is the question the page answers, not the product's name.

				The region is INSIDE the heading rather than in an eyebrow above it. "Kva skjer" on
				its own is a thin h1 for the page a search engine reaches first, and the place is half
				of what this site is. The span is block-level, and accessible-name computation puts a
				space between block children — so it announces as one sentence.
			-->
			<h1 class="display ask__h">
				Kva skjer<span class="ask__where">i {where}</span>
			</h1>

			<!--
				The trust argument, as one line rather than three display numerals.

				It was a definition list of "577 / Framover", "31 / Kjelder", "03. okt. / Sist henta",
				each in display type with its own label — three things to read before the first event,
				and the 577 said again by "Alt framover" directly below it. What is left is the part
				nothing else on the screen says: how many places this comes from, and how fresh it is.
			-->
			<p class="ask__fresh label">
				{status.sourceCount}
				{status.sourceCount === 1 ? 'kjelde' : 'kjelder'}
				{#if status.lastCollectedAt}
					· oppdatert
					<time datetime={status.lastCollectedAt.toISOString()}>
						{formatEventTime(status.lastCollectedAt, 'Europe/Oslo', 'card')}
					</time>
				{/if}
			</p>
		</div>

		<WaysIn />
	</div>
</header>

<style>
	.ask {
		padding-block: clamp(1.25rem, 3vw, 2rem) 0;
	}
	.ask__top {
		/* Display type is sized against its own column, never the viewport — docs/brand.md. */
		container-type: inline-size;
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.75rem var(--gutter);
		margin-block-end: clamp(1rem, 2.5vw, 1.5rem);
	}
	.ask__h {
		font-size: clamp(2rem, 10cqw, 4.25rem);
		margin: 0;
	}
	/*
	 * The place, a step down and on its own line.
	 *
	 * `em`, so it tracks the heading it belongs to instead of needing its own clamp — and a second
	 * `cqw` term here would be a second thing to keep in step with the first.
	 */
	.ask__where {
		display: block;
		font-size: 0.46em;
		font-stretch: 112%;
		color: var(--peach-dim);
		margin-block-start: 0.12em;
	}
	.ask__fresh {
		margin: 0;
		/* Half the label's tracking: this is a sentence, not a caption, and at the full 0.3em it
		   wrapped onto a second line at 390px. */
		letter-spacing: 0.14em;
		font-variant-numeric: tabular-nums;
	}
</style>
