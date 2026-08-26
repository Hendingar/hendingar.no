<script lang="ts">
	import { MANIFEST } from '../../content/landing.ts';
</script>

<!-- Named region: these are the three claims the brand rests on, and without a heading they were
     absent from the document outline entirely. -->
<section class="manifest invert" aria-labelledby="h-manifest">
	<h2 id="h-manifest" class="visually-hidden">Kva vi lovar</h2>
	<ul class="shell manifest__grid">
		{#each MANIFEST as claim, i (claim)}
			<li class="manifest__row">
				<span class="label" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
				<p class="display manifest__line" class:manifest__line--slant={i === 1}>{claim}</p>
			</li>
		{/each}
	</ul>
</section>

<style>
	.manifest {
		padding-block: clamp(2rem, 5vw, 3.5rem);
		border-block: var(--rule-fat) solid var(--navy-900);
	}
	.manifest__grid {
		display: grid;
		list-style: none;
		padding-inline: var(--gutter);
		margin: 0;
		container-type: inline-size;
	}
	.manifest__row {
		display: grid;
		grid-template-columns: 2.5rem 1fr;
		gap: 0 1rem;
		align-items: start;
		padding-block: 0.5rem;
	}
	.manifest__row + .manifest__row {
		border-block-start: var(--rule) solid rgb(22 34 59 / 25%);
	}
	.manifest__row .label {
		padding-block-start: 0.85em;
	}
	.manifest__line {
		font-size: clamp(1.35rem, 5.2cqw, 4.25rem);
		margin: 0;
	}
	.manifest__line--slant {
		font-style: italic;
	}
	/* Alternate the alignment so the band uses its full width. */
	.manifest__row:nth-child(2) {
		grid-template-columns: 1fr 2.5rem;
	}
	.manifest__row:nth-child(2) .label {
		grid-column: 2;
		text-align: end;
	}
	.manifest__row:nth-child(2) .manifest__line {
		grid-column: 1;
		grid-row: 1;
		text-align: end;
	}
</style>
