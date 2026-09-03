<script lang="ts">
	import EventsByDay from '../../lib/components/EventsByDay.svelte';
	import { heartedIds, loadHearts } from '../../lib/hearts.svelte.ts';
	import { heartCounts, listHearted } from '../../lib/hearts.remote';
	import type { UpcomingEvent } from '../../lib/events.remote';

	/**
	 * The reader's own hearted events.
	 *
	 * This is the one page in the site that deliberately does NOT server-render its content, and the
	 * reason is the feature's whole point: what you have hearted lives in your browser and is never
	 * sent anywhere we keep. The server cannot know the list before the page loads, so there is
	 * nothing to put in the HTML — and nothing here for a crawler, which is correct.
	 *
	 * Everywhere else in this codebase, a `.loading` flag would be the wrong tool (see CLAUDE.md).
	 * Here the wait is real and unavoidable rather than an artefact of SSR, so it is stated plainly.
	 */
	let ids = $state<number[]>([]);
	let loaded = $state(false);
	let events = $state<UpcomingEvent[]>([]);
	let counts = $state<Record<number, number>>({});

	$effect(() => {
		loadHearts();
		ids = heartedIds();
		loaded = true;
	});

	$effect(() => {
		if (!loaded) return;
		const wanted = ids;
		if (wanted.length === 0) {
			events = [];
			counts = {};
			return;
		}
		void (async () => {
			const [rows, hearts] = await Promise.all([listHearted(wanted), heartCounts(wanted)]);
			events = rows;
			counts = Object.fromEntries(hearts.map((h) => [h.eventId, h.hearts]));
		})();
	});

	/*
	 * Some ids may not come back: an event can be unpublished, or removed by its source. Saying so
	 * is better than quietly showing a shorter list, which reads as losing something.
	 */
	const missing = $derived(loaded ? ids.length - events.length : 0);
</script>

<svelte:head>
	<title>Hjarta — hendingar.no</title>
	<!-- Nothing to index: the content is per-visitor and lives in their browser. -->
	<meta name="robots" content="noindex" />
</svelte:head>

<section class="shell hearts">
	<p class="label">Dine</p>
	<h1 class="display hearts__h">Hjarta</h1>

	{#if !loaded}
		<p class="hearts__note">Hentar dine hjarta …</p>
	{:else if ids.length === 0}
		<p class="hearts__note">
			Du har ikkje hjarta noko enno. Trykk hjartet på ei hending, så hamnar ho her.
		</p>
		<p><a class="btn btn--solid" href="/hendingar">Sjå hendingar</a></p>
	{:else}
		<p class="hearts__note">
			{ids.length}
			{ids.length === 1 ? 'hending' : 'hendingar'} lagra i denne nettlesaren. Dei ligg berre her — vi
			veit ikkje kven du er, og lista følgjer deg ikkje til ein annan maskin.
		</p>
		{#if events.length > 0}
			<EventsByDay {events} headingLevel={2} hearts={counts} />
		{/if}
		{#if missing > 0}
			<p class="hearts__note">
				{missing}
				{missing === 1 ? 'hending' : 'hendingar'} du har hjarta er ikkje lenger publiserte, og blir difor
				ikkje viste.
			</p>
		{/if}
	{/if}
</section>

<style>
	.hearts {
		padding-block: var(--section-y);
	}
	.hearts__h {
		font-size: clamp(2rem, 7vw, 4rem);
		margin-block: 0.2em 0.5em;
	}
	.hearts__note {
		max-inline-size: 56ch;
		color: var(--peach-dim);
		margin-block-end: 1.5rem;
	}
</style>
