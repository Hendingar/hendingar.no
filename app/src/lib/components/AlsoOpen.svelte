<script lang="ts">
	import { eventPath } from '@hendingar/core/slug';
	import { standingOffers } from '../events.remote';

	/**
	 * One quiet line under a day's events: what is also open, as it is every day.
	 *
	 * A day page asks "what is on on this date", and the museum is an honest part of that answer —
	 * it just is not an appointment. So it appears as an aside rather than as four more cards
	 * competing with the concerts, names a couple, counts the rest, and hands the reader to the page
	 * that holds them all.
	 *
	 * The FRONT page does not get this line. It carries the whole section once instead, which is the
	 * point of the section: saying the same three places under every date is the repetition the
	 * change exists to remove.
	 *
	 * Top-level await, so the links are in the server-rendered HTML like everything else.
	 */
	const offers = await standingOffers();

	/** Two names is enough to say what kind of thing is behind the link. */
	const NAMED = 2;
	const named = $derived(offers.slice(0, NAMED));
	const rest = $derived(offers.length - named.length);
</script>

{#if offers.length > 0}
	<aside class="also" aria-label="Alltid ope">
		<span class="also__l">Òg ope denne dagen</span>
		<ul class="also__list">
			{#each named as offer (offer.id)}
				<li><a class="also__i" href={eventPath(offer.id, offer.title)}>{offer.title}</a></li>
			{/each}
		</ul>
		<a class="also__more" href="/alltid-ope">
			{rest > 0 ? `+ ${rest} andre →` : 'Alltid ope →'}
		</a>
	</aside>
{/if}

<style>
	.also {
		border-block-start: var(--rule) solid var(--peach-line);
		padding-block-start: 0.9rem;
		margin-block-start: 1.5rem;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.6rem 1rem;
	}
	.also__l {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.also__list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.also__i {
		display: inline-block;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--peach-dim);
		border: var(--rule) solid var(--peach-line);
		/* 0.75em block padding clears the 44px target at the 12px micro step. */
		padding: 0.75em 0.8em;
		transition:
			color var(--dur-fast) ease,
			border-color var(--dur-fast) ease;
	}
	.also__i:hover {
		color: var(--peach-hi);
		border-color: var(--peach);
	}
	.also__more {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach);
		margin-inline-start: auto;
	}
</style>
