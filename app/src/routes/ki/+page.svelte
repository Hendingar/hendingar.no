<script lang="ts">
	import { page } from '$app/state';
	import PageMeta from '../../lib/components/PageMeta.svelte';
	import { CAN_ASK, CLIENTS, PROMISES } from '../../lib/content/ki.ts';
	import { canonicalUrl } from '../../lib/origin.ts';

	/**
	 * How to connect hendingar.no to an assistant (ADR 0024).
	 *
	 * The address is rendered from the request rather than written into the copy, so the dev host
	 * shows its own `/mcp` — the same rule `canonicalUrl` keeps for every other link the site hands
	 * out. Everything here is static and server-rendered; there is nothing to wait for.
	 */
	const url = $derived(canonicalUrl(page.url, '/mcp'));
</script>

<PageMeta
	title="Bruk hendingar.no med KI — hendingar.no"
	description="Kopla hendingar.no til Claude, ChatGPT eller ein annan assistent, så kan han svare på kva som skjer i Stord, Bømlo og Fitjar."
	path="/ki"
/>

<section class="shell ki">
	<p class="label">For assistentar</p>
	<h1 class="display display--md">Spør assistenten din</h1>
	<p class="ki__lede">
		hendingar.no er ein MCP-tenar. Kopla han til Claude, ChatGPT eller ein annan KI-assistent, så
		svarar han på kva som skjer ut frå lista her — med lenkje og kjelde — i staden for å gjette.
	</p>

	<div class="frame ki__address">
		<p class="label">Adressa</p>
		<code class="ki__url">{url}</code>
	</div>

	<h2 class="display display--sm">Slik koplar du til</h2>
	<ol class="ki__clients">
		{#each CLIENTS as client (client.name)}
			<li>
				<h3>{client.name}</h3>
				{#each client.steps as step (step)}
					<p>{step}</p>
				{/each}
				{#if client.snippet}
					<pre class="ki__snippet"><code>{client.snippet.replace('{url}', url)}</code></pre>
				{/if}
			</li>
		{/each}
	</ol>

	<h2 class="display display--sm">Kva han kan finne</h2>
	<ul class="ki__list">
		{#each CAN_ASK as item (item)}
			<li>{item}</li>
		{/each}
	</ul>

	<h2 class="display display--sm">Det vi lovar</h2>
	<ul class="ki__list">
		{#each PROMISES as promise (promise)}
			<li>{promise}</li>
		{/each}
	</ul>

	<p class="fineprint">
		Model Context Protocol er ein open standard for å gi KI-assistentar tilgang til data. Tenaren er
		open kjeldekode, som resten av sida.
	</p>
</section>

<style>
	.ki {
		padding-block: 2rem 3rem;
		max-inline-size: 48rem;
	}
	.ki__lede {
		max-inline-size: 40rem;
	}
	.ki__address {
		margin-block: 1.5rem 2.5rem;
		padding: 1rem;
	}
	.ki__url {
		display: block;
		font-size: 1.15rem;
		overflow-wrap: anywhere;
	}
	.ki__clients {
		display: grid;
		gap: 1.5rem;
		padding-inline-start: 1.25rem;
		margin-block-end: 2.5rem;
	}
	/* A grid item will not shrink below its content, and a `<pre>` has no line breaks to shrink
	   by — without this the Claude Code command pushed the page 389px past a 320px phone. */
	.ki__clients > li {
		min-inline-size: 0;
	}
	.ki__clients h3 {
		margin-block: 0 0.25rem;
	}
	.ki__clients p {
		margin-block: 0.25rem;
	}
	/* Wrapped, not scrolled: a command to copy should be readable whole before anybody runs it. */
	.ki__snippet {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		padding: 0.75rem;
		border: 1px solid currentColor;
		tab-size: 2;
	}
	.ki__list {
		margin-block-end: 2.5rem;
	}
</style>
