<script lang="ts">
	import { formatEventTime } from '@hendingar/core/datetime';
	import { siteStatus } from '../../events.remote';
	import WaysIn from './WaysIn.svelte';

	/**
	 * The top of the page: the question, the three numbers that answer "is this worth using", and
	 * the four ways in.
	 *
	 * This replaced a full-height hero — a giant HENDINGAR wordmark, a halftone illustration, a
	 * lede and a paragraph about us. All of it was true and none of it was what a visitor came for.
	 * The wordmark is already in the masthead on every page, so the most valuable space on the site
	 * was spent saying the site's name a second time.
	 *
	 * The three numbers do the job the manifest band used to do, and do it better, because they are
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
			<div class="ask__q">
				<p class="label">Lokale hendingar</p>
				<!--
					The h1 is the question the page answers, not the product's name.

					It used to be the wordmark, stacked as two spans, which announced as "HEND INGAR"
					until an `aria-label` was bolted on to correct it. A heading that has to be
					corrected for screen readers is a heading doing a logo's job — and the logo is in
					the masthead, on every page.

					The region is INSIDE the heading rather than in the eyebrow above it. "Kva skjer"
					on its own is a thin h1 for the page a search engine reaches first, and the place
					is half of what this site is. The span is block-level, and accessible-name
					computation puts a space between block children — the very behaviour that broke
					the old wordmark works here, because here a space is what the sentence wants.
				-->
				<h1 class="display ask__h">
					Kva skjer<span class="ask__where">i {where}</span>
				</h1>
			</div>

			<!--
				The trust argument, in numbers rather than in prose.

				A definition list because that is what it is: three labelled values. The band it
				replaced said "Gratis for alltid / Ingen reklame / Data blir i Europa" in display
				type across a full screen — three promises a reader has no way to check, where three
				facts they can check now sit.
			-->
			<dl class="stats">
				<div>
					<dt class="label">Framover</dt>
					<dd>{status.upcomingCount}</dd>
				</div>
				<div>
					<dt class="label">Kjelder</dt>
					<dd>{status.sourceCount}</dd>
				</div>
				<div>
					<dt class="label">Sist henta</dt>
					<dd>
						{#if status.lastCollectedAt}
							<time datetime={status.lastCollectedAt.toISOString()}>
								{formatEventTime(status.lastCollectedAt, 'Europe/Oslo', 'card')}
							</time>
						{:else}
							—
						{/if}
					</dd>
				</div>
			</dl>
		</div>

		<WaysIn />
	</div>
</header>

<style>
	.ask {
		padding-block: clamp(1.75rem, 4vw, 2.75rem) 0;
	}
	.ask__top {
		display: grid;
		gap: clamp(1.5rem, 3vw, var(--gutter));
		align-items: end;
		margin-block-end: clamp(1.5rem, 3vw, 2.25rem);
	}
	@media (width >= 60rem) {
		.ask__top {
			grid-template-columns: minmax(0, 1fr) auto;
		}
	}

	.ask__q {
		/* Display type is sized against its own column, never the viewport — docs/brand.md. */
		container-type: inline-size;
	}
	.ask__h {
		font-size: clamp(2.25rem, 13cqw, 6rem);
		margin-block: 0.22em 0;
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

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem clamp(1.5rem, 3vw, 2.5rem);
		margin: 0;
	}
	/*
	 * The number first, the label under it — `column-reverse`, so the DOM keeps `dt` before `dd`
	 * as a definition list must.
	 *
	 * With the label on top the three numbers sat at three different heights, because "Kjelder vi
	 * hentar frå" wrapped to three lines and "Sist henta" to two. Reversed, every number sits on
	 * one line and the labels hang beneath them — and the labels could then be short, which is
	 * what stopped them wrapping in the first place.
	 */
	.stats > div {
		display: flex;
		flex-direction: column-reverse;
		align-items: flex-start;
		min-inline-size: 0;
		border-inline-start: var(--rule) solid var(--peach-line);
		padding-inline-start: 0.875rem;
	}
	.stats dt {
		margin: 0.35rem 0 0;
		line-height: 1.35;
	}
	.stats dd {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 112%;
		font-size: clamp(1.5rem, 3vw, 2.125rem);
		line-height: 0.9;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}
</style>
