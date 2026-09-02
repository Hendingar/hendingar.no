<script lang="ts">
	/**
	 * A source's own icon, hotlinked, with initials as the fallback.
	 *
	 * Hotlinked rather than proxied, matching the decision already made for poster images. Note
	 * this is a deliberate exception to the rule that got fonts self-hosted: a favicon leaks the
	 * visitor's IP to the source's CDN. It is accepted here because /datasamling already links to
	 * every source by name and URL, so the relationship is not a secret — and `referrerpolicy`
	 * keeps our path out of their logs.
	 */
	let {
		src = null,
		name,
		size = '2rem'
	}: { src?: string | null; name: string; size?: string } = $props();

	let failed = $state(false);

	// First letters of the first two words: "Det skjer Sunnhordland" → "DS".
	const initials = $derived(
		name
			.split(/\s+/)
			.slice(0, 2)
			.map((word) => word[0] ?? '')
			.join('')
			.toUpperCase()
	);
</script>

{#if src && !failed}
	<img
		class="icon"
		style:--size={size}
		{src}
		alt=""
		width="32"
		height="32"
		loading="lazy"
		decoding="async"
		referrerpolicy="no-referrer"
		onerror={() => (failed = true)}
	/>
{:else}
	<span class="icon icon--fallback" style:--size={size} aria-hidden="true">{initials}</span>
{/if}

<style>
	.icon {
		inline-size: var(--size);
		block-size: var(--size);
		flex: none;
		object-fit: contain;
		background: var(--navy-900);
		border: var(--rule) solid var(--peach-line);
	}
	.icon--fallback {
		display: grid;
		place-items: center;
		font-family: var(--font-mono);
		font-size: calc(var(--size) * 0.4);
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--peach-dim);
	}
</style>
