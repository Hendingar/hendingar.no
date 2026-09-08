<script lang="ts">
	// The count comes from core, not from this sentence. It said "Fem" for a day after a sixth
	// check shipped — see the note beside CHECK_COUNT_WORD.
	import { CHECK_COUNT_WORD_LEADING } from '../../checks.ts';
</script>

<!--
	The one thing left on the front page that is about us — and it is an action, not a claim.

	It replaces three sections: the manifest band, the verification pipeline with its checks,
	and a call to action offering the GitHub repository and an issue template. Those were five
	screens explaining the project to somebody who arrived asking what was on this evening.

	The checks themselves have not gone anywhere. `/send-inn` states them all BEFORE you
	submit, which is where they change what a person does; on the front page they described a
	process to people who were never going to start it. The promises live in the footer now, where
	fine print belongs, and the source link with them.

	One action, stated as the reader's own question rather than as our request: somebody who knows
	about a concert we have missed is the only person this section is for.
-->
<section class="join invert" aria-labelledby="h-join">
	<div class="shell join__inner">
		<div>
			<p class="label">Ver med</p>
			<h2 id="h-join" class="display join__h">Saknar du noko?</h2>
			<p class="join__p">
				Alle kan sende inn, utan konto. {CHECK_COUNT_WORD_LEADING} kontrollar før hendinga blir synleg
				— stoppar noko henne, seier vi kva, og du kan rette og prøve igjen.
			</p>
		</div>
		<a class="btn btn--invert" href="/send-inn">Send inn ei hending</a>
	</div>
</section>

<style>
	.join {
		margin-block-start: clamp(2.5rem, 6vw, 4rem);
		border-block-start: var(--rule-fat) solid var(--navy-900);
		padding-block: clamp(2rem, 5vw, 3.25rem);
	}
	.join__inner {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem 2.5rem;
		align-items: center;
		justify-content: space-between;
		/* The heading is sized against this, not the viewport — docs/brand.md. */
		container-type: inline-size;
	}
	.join__h {
		/*
		 * 9cqw keeps "Saknar" — the longest word — inside a 280px column at 320px wide. A shared
		 * `vw` step is what clipped the old call to action's final letter at that width.
		 */
		font-size: clamp(1.5rem, 9cqw, 2.75rem);
		margin-block: 0.3em 0;
		max-inline-size: 20ch;
	}
	.join__p {
		margin: 0.9rem 0 0;
		color: var(--navy-dim);
		max-inline-size: 52ch;
	}
</style>
