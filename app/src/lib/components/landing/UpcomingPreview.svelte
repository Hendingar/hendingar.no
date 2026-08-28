<script lang="ts">
	import EventList from '../EventList.svelte';
	import { listEvents } from '../../events.remote';

	/*
	 * Top-level await, NOT a boundary `pending` snippet. A `pending` snippet renders whenever the
	 * boundary is first created — which on the server is always — so it emitted "Lastar…" into the
	 * SSR HTML and shipped zero events. Awaiting here suspends the component instead, and SvelteKit
	 * waits for it before flushing the response.
	 */
	const events = await listEvents({ limit: 4 });
</script>

<section class="shell now" aria-labelledby="h-now">
	<p class="label">04 — Nett no</p>
	<h2 id="h-now" class="display now__h">Kva skjer?</h2>

	<!--
		`await` inside a boundary, not the query's .loading flag. The flag is always true on the
		server, so the previous version server-rendered "Lastar…" and shipped zero events in the
		HTML — invisible to crawlers and to anyone without JS, on an event-discovery site.
	-->
	<EventList {events}>
		{#snippet empty()}
			<p class="now__empty">
				Ingen hendingar enno.
				<a href="https://github.com/Hendingar/hendingar.no/issues">
					Kjenner du ein kalender vi bør hente frå?
				</a>
			</p>
		{/snippet}
	</EventList>
	<p><a href="/hendingar">Alle hendingar →</a></p>
</section>

<style>
	.now {
		padding-block: var(--section-y);
		container-type: inline-size;
	}
	.now__h {
		font-size: clamp(2rem, 12cqw, 7rem);
		margin-block: 0.25em 1.2em;
	}
	.now__empty {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: var(--step-mid);
		text-transform: uppercase;
		line-height: 1.15;
		max-inline-size: 30ch;
	}
</style>
