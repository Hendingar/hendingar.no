<script lang="ts">
	import EventsByDay from './EventsByDay.svelte';
	import { listEvents } from '../events.remote';
	import { heartCounts } from '../hearts.remote';
	import type { UpcomingEvent } from '../events.remote';
	import type { CategorySlug } from '@hendingar/core/taxonomy';

	/**
	 * A listing that fetches the next page before the reader reaches the bottom.
	 *
	 * "Preemptive" is the whole point: the sentinel sits well below the fold and the observer is
	 * given a generous `rootMargin`, so the request goes out while the reader is still scrolling
	 * through what they have. Done right, the list simply never ends and no spinner is ever seen.
	 *
	 * The first page is server-rendered by the page and handed in as a prop, so the HTML a crawler
	 * or a no-JS visitor gets is a real listing — this component only ever appends to it.
	 */
	let {
		first,
		firstHearts,
		pageSize,
		category,
		source,
		headingLevel = 2
	}: {
		first: UpcomingEvent[];
		firstHearts: Record<number, number>;
		pageSize: number;
		category?: CategorySlug;
		source?: string;
		headingLevel?: 2 | 3;
	} = $props();

	let extra = $state<UpcomingEvent[]>([]);
	let hearts = $state<Record<number, number>>({});
	let loading = $state(false);
	let reachedEnd = $state(false);
	let failed = $state(false);

	/*
	 * Reset when the filter changes.
	 *
	 * Otherwise switching category leaves the previous category's appended pages sitting under the
	 * new first page — a listing of musikk with twenty teater events beneath it.
	 *
	 * Tracked through a real comparison rather than by naming the props as bare expressions: that
	 * idiom works but reads as a mistake, and the linter agrees.
	 */
	let appliedFilter = $state('');
	$effect(() => {
		const key = `${category ?? ''}|${source ?? ''}`;
		if (key === appliedFilter) return;
		appliedFilter = key;
		extra = [];
		hearts = {};
		failed = false;
	});

	/*
	 * A short page is the last page.
	 *
	 * Cheaper and more honest than a COUNT over the whole table on every request: if the server
	 * returned fewer rows than we asked for, there is nothing after them.
	 */
	const noMoreOnFirst = $derived(first.length < pageSize);

	const events = $derived([...first, ...extra]);
	/* Either the server-rendered page was short, or a fetched one was. */
	const exhausted = $derived(noMoreOnFirst || reachedEnd);
	const allHearts = $derived({ ...firstHearts, ...hearts });

	async function loadMore() {
		if (loading || exhausted) return;
		loading = true;
		failed = false;
		try {
			const next = await listEvents({
				limit: pageSize,
				offset: events.length,
				category,
				source
			});
			if (next.length < pageSize) reachedEnd = true;
			if (next.length > 0) {
				/*
				 * Guard against duplicates.
				 *
				 * Offset paging re-reads a shifted window if an event is added or passes its start
				 * time between requests, and Svelte's keyed `{#each}` throws outright on a repeated
				 * key rather than rendering it twice. A listing must not crash because a concert
				 * started while someone was scrolling.
				 */
				const seen = new Set(events.map((e) => e.id));
				const fresh = next.filter((e) => !seen.has(e.id));
				extra = [...extra, ...fresh];

				const counts = await heartCounts(fresh.map((e) => e.id));
				hearts = { ...hearts, ...Object.fromEntries(counts.map((c) => [c.eventId, c.hearts])) };
			}
		} catch {
			// Offer the reader the button rather than an error: they already have a full page of
			// events, and the failure is only that there might be more.
			failed = true;
		} finally {
			loading = false;
		}
	}

	/**
	 * Watch the sentinel, and fire early.
	 *
	 * An action rather than an effect so the observer is torn down with the element it watches.
	 * `rootMargin` is what makes this preemptive: the callback runs when the sentinel is still
	 * 800px below the viewport, which on a normal scroll is a second or so of reading ahead.
	 */
	function watch(node: HTMLElement) {
		if (typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void loadMore();
			},
			{ rootMargin: '800px 0px' }
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}
</script>

<EventsByDay {events} {headingLevel} hearts={allHearts} />

{#if !exhausted}
	<div class="more" use:watch>
		{#if failed}
			<p class="more__note">Klarte ikkje hente fleire akkurat no.</p>
			<button type="button" class="btn" onclick={loadMore}>Prøv igjen</button>
		{:else}
			<!--
				A real button, not just a scroll trigger.

				Someone using a keyboard, or a browser that never fires the observer, still needs a
				way to reach the rest of the list. It is also what the reader taps if they scroll
				faster than the network.
			-->
			<button type="button" class="btn" onclick={loadMore} disabled={loading}>
				{loading ? 'Hentar …' : 'Vis fleire'}
			</button>
		{/if}
		<!-- Announced politely: a reader on a screen reader should learn the list grew, without the
		     announcement interrupting whatever they are on. -->
		<p class="visually-hidden" aria-live="polite">
			{loading ? 'Hentar fleire hendingar' : `${events.length} hendingar viste`}
		</p>
	</div>
{/if}

<style>
	.more {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding-block: 2.5rem 1rem;
	}
	.more__note {
		color: var(--peach-dim);
		margin: 0;
	}
</style>
