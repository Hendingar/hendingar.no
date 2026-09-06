<script lang="ts">
	import StandingGrid from '../StandingGrid.svelte';
	import { standingOffers } from '../../events.remote';

	/**
	 * The places that are open, gathered once, below the whole list.
	 *
	 * Below rather than inside the day groups, and that is the decision. Putting them at the foot of
	 * every day would have kept the repetition this change exists to remove — the escape room would
	 * still appear under fourteen headings, just lower down each time. It is on today, and it is on
	 * every other day too, so saying it once is the honest number of times.
	 *
	 * Below the coverage strip as well: that strip is the last word about the event LIST, and this
	 * is not part of that list. Above it, the section would read as a caveat on the count.
	 *
	 * Top-level await, so it is in the server-rendered HTML (CLAUDE.md).
	 */
	const offers = await standingOffers();

	/** Four fills one row at the widest breakpoint; the rest are one link away. */
	const PREVIEW = 4;
</script>

{#if offers.length > 0}
	<section class="standing" aria-labelledby="h-standing">
		<div class="shell">
			<div class="standing__head">
				<div>
					<p class="label">Ikkje bunde til ein dag</p>
					<h2 id="h-standing" class="display standing__h">Alltid ope</h2>
					<p class="standing__lede">
						Museum, galleri, symjehallar og faste aktivitetar. Dei står her i staden for å fylle
						kvar einaste dag i lista over.
					</p>
				</div>
				{#if offers.length > PREVIEW}
					<a class="btn standing__more" href="/alltid-ope">
						Sjå alle {offers.length}
					</a>
				{/if}
			</div>

			<StandingGrid {offers} limit={PREVIEW} />
		</div>
	</section>
{/if}

<style>
	.standing {
		margin-block-start: clamp(2.5rem, 6vw, 4rem);
		padding-block: clamp(2rem, 5vw, 3rem) clamp(2rem, 5vw, 3.25rem);
		border-block-start: var(--rule-fat) solid var(--peach-line);
	}
	.standing__head {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem 2.5rem;
		align-items: flex-end;
		justify-content: space-between;
		margin-block-end: clamp(1.25rem, 3vw, 1.75rem);
		/* Display type is sized against its own container, never the viewport — docs/brand.md. */
		container-type: inline-size;
	}
	.standing__h {
		font-size: clamp(1.6rem, 7cqw, 2.5rem);
		margin-block: 0.22em 0;
	}
	.standing__lede {
		margin: 0.75rem 0 0;
		color: var(--peach-dim);
		max-inline-size: 48ch;
	}
	.standing__more {
		flex: none;
	}
</style>
