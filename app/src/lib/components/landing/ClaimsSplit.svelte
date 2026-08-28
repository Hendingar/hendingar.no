<script lang="ts">
	import { DOES, DOES_NOT } from '../../content/landing.ts';
</script>

<!-- Two sections, not one. A single region labelled "Samlar alt" that also contained the
     "Nektar resten" column told screen-reader users they were in the "what it does" region while
     reading the "what it does NOT do" column — inverted context for the one part of the page
     whose meaning is negation. -->
<div class="shell split">
	<section aria-labelledby="h-does">
		<p class="label">01 — Kva det gjer</p>
		<h2 id="h-does" class="display split__h">Samlar<br />alt</h2>
		<ul class="listy">
			{#each DOES as item (item)}
				<li>{item}</li>
			{/each}
		</ul>
	</section>

	<section aria-labelledby="h-does-not">
		<p class="label">02 — Kva det ikkje gjer</p>
		<h2 id="h-does-not" class="display split__h display--outline">Nektar<br />resten</h2>
		<dl class="nots">
			{#each DOES_NOT as claim (claim.term)}
				<div class="not">
					<dt>{claim.term}</dt>
					<dd>{claim.body}</dd>
				</div>
			{/each}
		</dl>
		<p class="fineprint">
			Presisjon er ein funksjon. Ei hending skal føre folk saman — ikkje vere ein bomstasjon.
		</p>
	</section>
</div>

<style>
	.split {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 21rem), 1fr));
		gap: var(--section-y) var(--gutter);
		padding-block: var(--section-y);
	}
	.split > section {
		container-type: inline-size;
	}
	.split__h {
		/* cqw, so the heading tracks its grid column rather than the viewport. At 9vw it
		   overflowed the column by 60px at 1000px wide. */
		font-size: clamp(2rem, 17cqw, 7rem);
		margin-block: 0.25em 0.55em;
	}

	.listy {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.listy li {
		padding-block: 0.9rem;
		border-block-start: var(--rule) solid var(--peach-line);
	}

	.nots {
		margin: 0;
	}
	.not {
		padding-block: 0.9rem;
		border-block-start: var(--rule) solid var(--peach-line);
	}
	.not dt {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 118%;
		text-transform: uppercase;
		font-size: var(--step-mid);
		line-height: 1;
	}
	.not dd {
		margin: 0.35rem 0 0;
		color: var(--peach-dim);
	}
</style>
