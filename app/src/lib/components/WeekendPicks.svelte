<script lang="ts">
	import { formatEventTime } from '@hendingar/core/datetime';
	import { eventPath } from '@hendingar/core/slug';
	import type { WeekendPick } from '../server/kurator';

	/**
	 * What the kurator would go to this weekend, and why (ADR 0018).
	 *
	 * Presented as an opinion, because that is what it is. Every other ordering on this site is
	 * arithmetic — soonest first, most hearted, most opened — and each of those can be checked. This
	 * one cannot, so it carries its reasoning on its face: three sentences a reader can disagree
	 * with beat a badge that says "anbefalt" and explains nothing.
	 *
	 * Three deliberate absences. No score and no stars, because there is nothing measured to show.
	 * No heart or view counts, because the kurator was never told them and a number here would
	 * imply it was. And no claim to completeness: this sits above the full listing and never
	 * replaces it, so a reader who disagrees with all three picks has lost nothing but a scroll.
	 */
	let { picks }: { picks: readonly WeekendPick[] } = $props();
</script>

{#if picks.length > 0}
	<section class="picks" aria-labelledby="picks-h">
		<p class="label" id="picks-h">Kuratoren si helg</p>
		<p class="picks__lede">
			Eit utval frå programmet under, valt av ein AI-kurator som ikkje veit kva som er populært —
			berre kva som står i oppføringane.
		</p>

		<ol class="picks__list">
			{#each picks as pick (pick.eventId)}
				<li class="pick">
					<a class="pick__title" href={eventPath(pick.eventId, pick.title)}>{pick.title}</a>
					<p class="pick__meta">
						{formatEventTime(pick.startsAt, pick.venueTimeZone) +
							(pick.venueName ? ` · ${pick.venueName}` : '')}
					</p>
					<p class="pick__reason">{pick.reason}</p>
				</li>
			{/each}
		</ol>
	</section>
{/if}

<style>
	/*
	 * A left rule, not a box or a hero.
	 *
	 * It sits above a listing it is a subset of, and a boxed panel would read as a different
	 * feature rather than as a way into the same weekend.
	 */
	.picks {
		padding-inline-start: 1rem;
		border-inline-start: var(--rule-fat) solid var(--peach);
		display: grid;
		gap: 0.6rem;
		margin-block: 0.5rem 1.5rem;
	}
	.picks__lede {
		margin: 0;
		max-inline-size: 62ch;
		color: var(--peach-dim);
		font-size: 0.875rem;
	}
	.picks__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1rem;
	}
	.pick {
		display: grid;
		gap: 0.25rem;
		justify-items: start;
	}
	.pick__title {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 112%;
		text-transform: uppercase;
		font-size: var(--step-mid);
		line-height: 1;
		overflow-wrap: anywhere;
	}
	.pick__meta {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}
	.pick__reason {
		margin: 0;
		max-inline-size: 62ch;
	}
</style>
