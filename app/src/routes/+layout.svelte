<script lang="ts">
	// Self-hosted fonts, not Google Fonts. A privacy-first project should not leak visitor IPs to a
	// third party for the sake of a typeface — and Google Fonts hotlinking has a GDPR history.
	import '@fontsource-variable/archivo/wdth.css';
	import '@fontsource-variable/archivo/wdth-italic.css';
	import '@fontsource/space-mono/400.css';
	import '@fontsource/space-mono/700.css';
	import '#lib/styles/brand.css';

	import favicon from '#lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#1e2c4a" />
</svelte:head>

{@render children()}
