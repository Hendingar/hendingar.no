<script lang="ts">
	import { PIPELINE } from '../checks.ts';

	/**
	 * The five checks as a rail of numbered steps.
	 *
	 * Shared between `/` and `/send-inn` rather than copied: the submission page used to describe
	 * the checks in a paragraph at the very bottom, which is both a second telling and the wrong
	 * place — the checks are the reason to trust an open submission form, so they belong where
	 * somebody is deciding whether to use one.
	 */
</script>

<ol class="steps">
	{#each PIPELINE as step, i (step.name)}
		<li class="step">
			<span class="step__n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
			<span class="step__name">{step.name}</span>
			<span class="step__what">{step.what}</span>
		</li>
	{/each}
</ol>

<style>
	.steps {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		/* 12rem, not 17: there are five checks, and a 17rem minimum fits four per row on a laptop,
		   which strands the fifth alone on a second row. Sized so all five sit on one line where
		   there is room, and the count comes from core — so this must not assume a number. */
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
		gap: 0 1.25rem;
	}
	.step {
		display: grid;
		gap: 0.3rem;
		padding: 1.4rem 1.4rem 1.6rem 0;
		border-block-start: var(--rule) solid var(--peach-line);
	}
	.step__n {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 125%;
		font-size: 2.6rem;
		line-height: 0.8;
		color: var(--peach-quiet);
	}
	.step__name {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 112%;
		text-transform: uppercase;
		font-size: 1.1rem;
	}
	.step__what {
		color: var(--peach-dim);
		font-size: 0.875rem;
	}
</style>
