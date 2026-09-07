<script lang="ts">
	import { formatEventTime } from '@hendingar/core/datetime';
	import { describeFields } from '@hendingar/core/contribution';
	import type { ContributionCandidate } from '../../submit.remote';

	/**
	 * The way out of "liknar på «X»".
	 *
	 * A submission held back by the duplicate check used to end here: the reasoning named an event
	 * we already had and the only routes forward were to edit the title until it stopped matching —
	 * which publishes a second row and is a lie — or to let the submission expire, taking the poster
	 * and the source link with it. The person was holding exactly what the existing row lacked.
	 *
	 * So the same finding is offered as an action. Each candidate says what it is missing, because
	 * "hjelp oss gjere henne betre" is not a reason to click anything and "ho manglar bilete" is.
	 */
	let {
		submissionId,
		candidates
	}: {
		submissionId: number;
		candidates: readonly ContributionCandidate[];
	} = $props();
</script>

{#if candidates.length > 0}
	<aside class="offer">
		<p class="label">Er det den same hendinga?</p>
		<p class="offer__lede">
			{candidates.length === 1
				? 'Vi har denne frå før. Er det den same, kan innsendinga di gjere henne betre i staden for å bli liggande i køen.'
				: 'Vi har desse frå før. Er ei av dei den same, kan innsendinga di gjere henne betre i staden for å bli liggande i køen.'}
		</p>

		<ul class="offer__list">
			{#each candidates as candidate (candidate.id)}
				<li class="cand">
					<a class="cand__title" href={candidate.path}>{candidate.title}</a>
					<p class="cand__meta">
						<!-- Separator inside the expression: a bare "·" between an {#if} and its text is
						     collapsed at the boundary, and the time runs straight into the venue name. -->
						{formatEventTime(new Date(candidate.startsAt), candidate.venueTimeZone) +
							(candidate.venueName ? ` · ${candidate.venueName}` : '') +
							(candidate.sourceName ? ` · ${candidate.sourceName}` : '')}
					</p>

					{#if candidate.gaps.length > 0}
						<p class="cand__gaps">
							Ho manglar {describeFields([...candidate.gaps])}.
						</p>
					{:else}
						<!--
							Nothing to fill, and saying so is better than an invitation that quietly
							changes nothing. Confirming is still worth something — it is recorded as an
							independent account of the same event — so the offer stands, described
							honestly rather than dressed up.
						-->
						<p class="cand__gaps">
							Ho har alt det du sende. Å stadfeste henne endrar ingenting, men blir notert.
						</p>
					{/if}

					<!--
						A link, not a form button.

						It opens the submission form with the draft loaded and the target set, so the
						contributor reads what they are about to hand over before anything moves — the
						same review step that makes reading a poster with a model safe.
					-->
					<a
						class="btn btn--solid cand__go"
						href="/send-inn?rett={submissionId}&bidra={candidate.id}"
					>
						{candidate.gaps.length > 0 ? 'Gjer denne betre' : 'Ja, det er den same'}
					</a>
				</li>
			{/each}
		</ul>
	</aside>
{/if}

<style>
	/*
	 * A left rule rather than a box, matching the duplicate citation it sits near: this is a
	 * follow-up to a verdict, and a second boxed panel would compete with the verdict itself.
	 */
	.offer {
		padding-inline-start: 1rem;
		border-inline-start: var(--rule-fat) solid var(--peach);
		display: grid;
		gap: 0.5rem;
	}
	.offer__lede {
		margin: 0;
		max-inline-size: 60ch;
	}
	.offer__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1rem;
	}
	.cand {
		display: grid;
		gap: 0.3rem;
		/* Its own start so a candidate reads as one item, not as three loose paragraphs. */
		justify-items: start;
	}
	.cand__title {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 112%;
		text-transform: uppercase;
		font-size: var(--step-mid);
		line-height: 1;
		overflow-wrap: anywhere;
	}
	.cand__meta {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}
	.cand__gaps {
		margin: 0;
		font-size: 0.875rem;
		color: var(--peach-dim);
	}
	.cand__go {
		margin-block-start: 0.35rem;
	}
</style>
