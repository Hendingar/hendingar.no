<script lang="ts">
	import { page } from '$app/state';
	import EventPage from '../../../lib/components/hending/EventPage.svelte';

	/*
	 * One event page per event, remounted when the event changes.
	 *
	 * SvelteKit keeps a page's component alive across a navigation within the same route, and the
	 * page reads its event with a top-level await — which runs once. So tapping from one event to
	 * another changed the address and left the first event on screen, along with its view count,
	 * its heart and its analytics. It was rare while the only such link was a film's other
	 * screenings; with "more from this day / source / kind" on every page it is the common path.
	 *
	 * Keyed on the address rather than rewritten as derived awaits: everything on the page — the counted view,
	 * whether this reader hearted it, the events tracked — is about one event, and starting it all
	 * over is what is true when the event is a different one.
	 */
</script>

{#key page.url.pathname}
	<EventPage />
{/key}
