<section class="cta invert" aria-labelledby="h-cta">
	<div class="shell cta__inner">
		<div>
			<p class="label">Ver med</p>
			<h2 id="h-cta" class="display cta__h">Lokalsamfunn veit best kva som skjer</h2>
		</div>
		<div class="cta__actions">
			<a class="btn btn--invert" href="https://github.com/Hendingar/hendingar.no/issues/new/choose">
				Foreslå ei kjelde
			</a>
			<a class="btn btn--invert-ghost" href="https://github.com/Hendingar/hendingar.no">
				Kjeldekode
			</a>
		</div>
	</div>
</section>

<style>
	.cta {
		padding-block: var(--section-y);
		border-block-start: var(--rule-fat) solid var(--navy-900);
	}
	.cta__inner {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
		gap: var(--gutter);
		align-items: end;
	}
	.cta__inner > div:first-child {
		container-type: inline-size;
	}
	.cta__h {
		/* Was clamp(2rem, 5vw, …): the 2rem floor overflowed a 280px column at 320px wide and
		   clipped the final letter of the page's main call to action. */
		/* 8.5cqw keeps "Lokalsamfunn" (the longest word) inside a 280px column. */
		font-size: clamp(1.25rem, 8.5cqw, 3.5rem);
		margin-block: 0.3em 0;
		max-inline-size: 26ch;
	}
	.cta__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
</style>
