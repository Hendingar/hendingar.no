<script lang="ts">
	import EventList from '../../lib/components/EventList.svelte';
	import { listEvents } from '../../lib/events.remote';

	// See UpcomingPreview: top-level await so the list is in the server-rendered HTML.
	const events = await listEvents({ limit: 100 });
</script>

<svelte:head>
	<title>Alle hendingar — hendingar.no</title>
</svelte:head>

<div class="shell list">
	<p class="label">Full liste</p>
	<h1 class="display list__h">Alle hendingar</h1>

	<!-- headingLevel 2 so each event title nests under this page's h1. Previously the titles were
	     <strong>, which left a 100-item list with no headings to navigate by. -->
	<EventList {events} headingLevel={2} />

	<p><a href="/">Tilbake</a></p>
</div>

<style>
	.list {
		padding-block: var(--section-y);
		container-type: inline-size;
	}
	.list__h {
		/* cqw floors low enough to survive a 320px viewport — the old clamp floor of 2.75rem
		   clipped the final letter of this heading. */
		font-size: clamp(1.75rem, 13cqw, 7rem);
		margin-block: 0.5rem 2rem;
	}
</style>
