<script lang="ts">
	// Self-hosted fonts, not Google Fonts. A privacy-first project should not leak visitor IPs to a
	// third party for the sake of a typeface — and Google Fonts hotlinking has a GDPR history.
	import '@fontsource-variable/archivo/wdth.css';
	import '@fontsource-variable/archivo/wdth-italic.css';
	import '@fontsource/space-mono/400.css';
	import '@fontsource/space-mono/700.css';
	import '#lib/styles/brand.css';

	import favicon from '#lib/assets/favicon.svg';
	import SiteFooter from '../lib/components/SiteFooter.svelte';
	import SiteMasthead from '../lib/components/SiteMasthead.svelte';
	import type { LayoutProps } from './$types';

	// Typed, not bare $props() — an untyped destructure makes `children` implicitly any, which
	// CLAUDE.md rule 4 forbids. Kit generates this type for us.
	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#1e2c4a" />
</svelte:head>

<a class="skip" href="#innhald">Gå til innhaldet</a>

<SiteMasthead />

<!-- Page chrome lives here so both routes get the same landmarks and the same footer. The landing
     page previously had no <main> at all, which put its h1 and both CTAs inside role=banner —
     precisely the region a screen-reader user skips first. -->
<main id="innhald">
	{@render children()}
</main>

<SiteFooter />

<style>
	.skip {
		position: absolute;
		inset-block-start: 0;
		inset-inline-start: 0;
		z-index: 10;
		transform: translateY(-120%);
		background: var(--peach);
		color: var(--navy-900);
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		text-decoration: none;
		padding: 1em 1.4em;
	}
	.skip:focus {
		transform: translateY(0);
	}
</style>
