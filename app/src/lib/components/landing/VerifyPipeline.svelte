<script lang="ts">
	import { PIPELINE } from '../../content/landing.ts';
</script>

<section class="verify" aria-labelledby="h-verify">
	<div class="shell">
		<p class="label">03 — Verifisering</p>
		<h2 id="h-verify" class="display verify__h">Open innsending,<br />utan søppel</h2>
		<p class="verify__lede">
			Innsende hendingar går gjennom eit agent-steg før dei blir synlege. Er noko usikkert, går det
			til eit menneske. Agenten sorterer, folk avgjer.
		</p>
		<ol class="steps">
			{#each PIPELINE as step, i (step.name)}
				<li class="step">
					<span class="step__n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
					<span class="step__name">{step.name}</span>
					<span class="step__what">{step.what}</span>
				</li>
			{/each}
		</ol>
		<p class="fineprint">
			Importørar er derimot heilt deterministiske — ingen språkmodell hentar data. Oppdikta
			hendingar er verre enn ingen hendingar.
		</p>
	</div>
</section>

<style>
	.verify {
		background: var(--navy-900);
		border-block: var(--rule) solid var(--peach-line);
		padding-block: var(--section-y);
		container-type: inline-size;
	}
	.verify__h {
		font-size: clamp(1.75rem, 5.5cqw, 3.75rem);
		margin-block: 0.3em 0.8em;
	}
	.verify__lede {
		max-inline-size: 52ch;
		margin: 0 0 2.5rem;
	}
	.steps {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
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
