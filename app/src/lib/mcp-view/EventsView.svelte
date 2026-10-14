<script lang="ts">
	import { App } from '@modelcontextprotocol/ext-apps';
	import { viewResultSchema, type ViewEvent, type ViewResult } from '@hendingar/core/public-event';
	import { groupByDay } from './days.ts';
	import ViewCard from './ViewCard.svelte';

	/**
	 * The MCP App view: what `show_events` looks like in a client that can draw it (ADR 0024).
	 *
	 * It is a page in a sandboxed frame inside somebody else's chat. It never fetches anything:
	 * the host hands it the tool result, and every link is opened by asking the host. The result is
	 * parsed with the same schema the server wrote it with, so a malformed one is a stated failure
	 * rather than a half-drawn card.
	 */
	let result = $state<ViewResult | null>(null);
	let failed = $state(false);

	const app = new App({ name: 'hendingar.no', version: '1.0.0' });

	// Handlers before `connect`, or a result delivered during the handshake is lost.
	app.ontoolresult = ({ structuredContent }) => {
		const parsed = viewResultSchema.safeParse(structuredContent);
		if (parsed.success) result = parsed.data;
		else failed = true;
	};
	void app.connect();

	function open(url: string) {
		void app.openLink({ url });
	}

	/** Ask the assistant, in the reader's place, for more on one event. */
	function ask(event: ViewEvent) {
		void app.sendMessage({
			role: 'user',
			content: [{ type: 'text', text: `Fortel meir om «${event.title}» (hending ${event.id}).` }]
		});
	}

	const days = $derived(result ? groupByDay(result.events, result.today) : []);
	const single = $derived(result?.events.length === 1);
	const siteUrl = $derived(result?.events[0] ? new URL('/', result.events[0].url).href : null);
</script>

<main class="view">
	<header class="view__head">
		<p class="label">
			{#if siteUrl}
				<a href={siteUrl} onclick={(e) => (e.preventDefault(), open(siteUrl))}>hendingar.no</a>
			{:else}
				hendingar.no
			{/if}
		</p>
		{#if result?.heading}
			<h2 class="view__heading">{result.heading}</h2>
		{/if}
	</header>

	{#if failed}
		<p class="view__note">Klarte ikkje å vise hendingane. Svaret står i teksten.</p>
	{:else if !result}
		<p class="view__note">Hentar …</p>
	{:else if result.events.length === 0}
		<p class="view__note">Fann ingen av desse hendingane.</p>
	{:else}
		{#each days as day (day.date)}
			<section class="view__day">
				<h3 class="label view__date">{day.label}</h3>
				{#each day.events as event (event.id)}
					<ViewCard {event} {open} {ask} wide={single} />
				{/each}
			</section>
		{/each}
	{/if}
</main>

<style>
	.view {
		padding: 1rem 1.1rem 1.2rem;
		background: var(--navy);
		color: var(--peach);
		font-family: var(--font-mono);
		font-size: 0.9rem;
	}
	.view__head {
		margin-block-end: 0.5rem;
	}
	.view__head a {
		color: inherit;
	}
	.view__heading {
		margin: 0.25rem 0 0;
		font-family: var(--font-display);
		font-size: 1.4rem;
		line-height: 1.15;
		color: var(--peach-hi);
		text-transform: uppercase;
	}
	.view__day + .view__day {
		margin-block-start: 0.75rem;
	}
	.view__date {
		margin: 0.75rem 0 0.25rem;
	}
	.view__note {
		margin: 0.5rem 0 0;
		color: var(--peach-dim);
	}
</style>
