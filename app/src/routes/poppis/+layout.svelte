<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	/**
	 * Two orderings of the same question, so they share a page rather than being two pages.
	 *
	 * Real links, not JavaScript tabs: each ordering is a thing you can send someone, and both work
	 * with scripting off. `aria-current="page"` is what tells a screen reader which one is showing —
	 * the colour alone says it to sighted readers only.
	 */
	const TABS = [
		{ href: '/poppis/hjarta', label: 'Flest hjarte' },
		{ href: '/poppis/vist', label: 'Mest opna' }
	] as const;
</script>

<section class="poppis shell">
	<p class="label">Poppis</p>
	<h1 class="display poppis__h">Det folk ser på</h1>
	<p class="poppis__lede">
		Hendingar som kjem, sortert etter kva folk har merkt seg. Berre ting som ikkje har vore enno —
		ei utseld konsert frå i vår hadde vore ei rangering, ikkje ei oversikt.
	</p>

	<nav class="tabs" aria-label="Sortering">
		{#each TABS as tab (tab.href)}
			<a
				class="tab"
				class:tab--on={page.url.pathname === tab.href}
				href={tab.href}
				aria-current={page.url.pathname === tab.href ? 'page' : undefined}
			>
				{tab.label}
			</a>
		{/each}
	</nav>
</section>

{@render children()}

<style>
	.poppis {
		padding-block: clamp(2.5rem, 7vw, 4.5rem) clamp(1rem, 3vw, 1.75rem);
		display: grid;
		gap: 0.6rem;
		/* Display type is sized against its own container, never the viewport — see docs/brand.md. */
		container-type: inline-size;
	}
	.poppis__h {
		margin: 0.1em 0 0;
		font-size: clamp(2rem, 11cqw, 5rem);
		line-height: 0.95;
	}
	.poppis__lede {
		margin: 0;
		max-inline-size: 52ch;
		color: var(--peach-dim);
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0;
		margin-block-start: 0.9rem;
	}
	.tab {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		padding: 0.9em 1.4em;
		color: var(--peach-dim);
		text-decoration: none;
		border: var(--rule) solid var(--peach-line);
	}
	.tab + .tab {
		border-inline-start: 0;
	}
	.tab:hover {
		color: var(--peach-hi);
	}
	.tab--on {
		color: var(--navy-900);
		background: var(--peach);
		border-color: var(--peach);
	}
</style>
