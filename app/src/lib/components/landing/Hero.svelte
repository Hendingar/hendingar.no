<script lang="ts">
	import HeroArt from './HeroArt.svelte';
</script>

<header class="hero">
	<div class="hero__rail" aria-hidden="true">
		<span class="label label--vertical">AGPL · EU-hosta</span>
	</div>

	<div class="hero__type">
		<p class="label">Lokale hendingar · Europa</p>

		<ul class="pips" aria-hidden="true">
			{#each [0, 1, 2, 3, 4, 5] as i (i)}
				<li class="pip" data-on={i < 2}></li>
			{/each}
		</ul>
		<p class="label phase">Fase 2 — MVP</p>

		<!-- aria-label because accessible-name computation inserts a space between block-level
		     children, so the two decorative spans made the h1 announce as "HEND INGAR". -->
		<h1 class="display hero__word" aria-label="Hendingar">
			<span class="hero__line" aria-hidden="true">Hend</span><span
				class="hero__line display--outline"
				aria-hidden="true">ingar</span
			>
		</h1>

		<p class="hero__lede">
			Alt som skjer i lokalsamfunnet ditt. <em>Éin</em> stad.
		</p>

		<p class="hero__body">
			Kvart lokalsamfunn har konsertar på pub, teater, gardsbesøk, kulturhus, kurs og møte. Å finne
			dei krev at du leitar gjennom eit titals Facebook-sider. Det held ikkje.
		</p>

		<div class="hero__actions">
			<a class="btn btn--solid" href="/hendingar">Sjå hendingar</a>
			<a class="btn" href="https://github.com/Hendingar/hendingar.no">Bidra på GitHub</a>
		</div>
	</div>

	<HeroArt />
</header>

<style>
	.hero {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) minmax(0, 0.85fr);
		gap: var(--gutter);
		align-items: start;
		max-inline-size: 88rem;
		margin-inline: auto;
		padding: clamp(1.5rem, 4vw, 3rem) var(--gutter) clamp(2.5rem, 6vw, 5rem);
	}

	.hero__type {
		/* Size display type against this column, not the viewport — see docs/brand.md. */
		container-type: inline-size;
	}

	.hero__rail {
		border-inline-end: var(--rule) solid var(--peach-line);
		padding-inline-end: 0.9rem;
		align-self: stretch;
		display: flex;
		align-items: center;
		justify-content: center;
		min-block-size: 22rem;
	}

	.pips {
		margin-block-start: 1.75rem;
	}
	.phase {
		margin-block: 0.6rem 0;
	}

	.hero__word {
		font-size: clamp(2.75rem, 23.5cqw, 13rem);
		margin-block-start: 0.35em;
	}
	.hero__line {
		display: block;
	}

	.hero__lede {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 110%;
		font-size: clamp(1.4rem, 8.2cqw, 3.1rem);
		line-height: 1.02;
		text-transform: uppercase;
		margin-block: 1.1em 0.6em;
	}
	.hero__lede em {
		font-style: italic;
		color: var(--peach-hi);
	}

	.hero__body {
		max-inline-size: 42ch;
		margin: 0;
	}

	.hero__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-block-start: 2rem;
	}

	@media (width < 60rem) {
		.hero {
			grid-template-columns: 1fr;
		}
		.hero__rail {
			display: none;
		}
		.hero :global(.art) {
			order: -1;
			aspect-ratio: 4 / 3;
		}
	}
</style>
