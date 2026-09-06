<script lang="ts">
	import { page } from '$app/state';
	import { DEFAULT_TIME_ZONE, formatWeekendRange, weekendAhead } from '@hendingar/core/datetime';
	import { eventPath } from '@hendingar/core/slug';
	import EventsByDay from '../../lib/components/EventsByDay.svelte';
	import PageMeta from '../../lib/components/PageMeta.svelte';
	import { localDayKey } from '../../lib/calendar.ts';
	import { canonicalUrl } from '../../lib/origin.ts';
	import { breadcrumbJsonLd, itemListJsonLd, jsonLdScript } from '../../lib/jsonld.ts';
	import { weekendEvents } from '../../lib/events.remote';
	import { heartCounts } from '../../lib/hearts.remote';

	/**
	 * What is on this weekend.
	 *
	 * The question a local events site is asked most often, and until now the site could not answer
	 * it: a reader had to open the calendar, work out which squares were the weekend, and visit
	 * three day pages. `/hendingar` answers "what is next" and `/kalender` answers "what is on that
	 * date"; neither answers "what am I doing on Saturday".
	 *
	 * Top-level await, not a `.loading` flag — this is public content and has to be in the
	 * server-rendered HTML for crawlers and for readers without JavaScript (CLAUDE.md).
	 */
	const events = await weekendEvents();
	const hearts = Object.fromEntries(
		(await heartCounts(events.map((e) => e.id))).map((h) => [h.eventId, h.hearts])
	);

	/*
	 * The same dates the query used, worked out again here rather than returned alongside the rows.
	 *
	 * `weekendAhead` is pure and cheap, and a page that derives its own heading from today cannot
	 * print a range that disagrees with the rows it is showing — which a value carried through the
	 * query could, if the two were computed either side of midnight.
	 */
	const dates = $derived(weekendAhead(localDayKey(new Date(), DEFAULT_TIME_ZONE)));
	const range = $derived(formatWeekendRange(dates));

	const jsonLd = $derived([
		itemListJsonLd(
			'Hendingar i Sunnhordland denne helga',
			events.map((e) => canonicalUrl(page.url, eventPath(e.id, e.title)))
		),
		breadcrumbJsonLd([
			{ name: 'Framsida', url: canonicalUrl(page.url, '/') },
			{ name: 'Neste helg', url: canonicalUrl(page.url, '/neste-helg') }
		])
	]);
</script>

<PageMeta
	title="Neste helg — hendingar.no"
	description="Alt som skjer i Sunnhordland fredag til sundag. Konsertar, gudstenester, marknader og turar, samla frå lokale kalendrar."
	path="/neste-helg"
/>

<svelte:head>
	{#each jsonLd as node, i (i)}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON.stringify output, escaped in jsonLdScript -->
		{@html `<script type="application/ld+json">${jsonLdScript(node)}</${'script'}>`}
	{/each}
</svelte:head>

<div class="shell weekend">
	<!--
		"Helga i Sunnhordland", not "fredag til sundag".

		The second is only true on a Friday. By Sunday the page is showing one day, and an eyebrow
		promising three above a heading that delivers one is the kind of small lie that makes a
		reader distrust the rest. The exact days are on the line under the heading, where they can
		change without contradicting anything.
	-->
	<p class="label">Helga i Sunnhordland</p>
	<h1 class="display weekend__h">Neste helg</h1>
	<!--
		The dates, always, and not only as decoration.

		"Neste helg" is ambiguous on a Saturday — grammatically it is the weekend after this one,
		and this page deliberately shows the one you are standing in. Printing the range is what
		makes that a choice rather than a guess the reader has to make.
	-->
	<p class="weekend__range">{range}</p>

	{#if events.length > 0}
		<p class="weekend__count">
			{events.length === 1 ? 'Éi hending' : `${events.length} hendingar`}
		</p>
		<!-- headingLevel 2 so each day nests under this page's h1. -->
		<EventsByDay {events} {hearts} headingLevel={2} />
	{:else}
		<!--
			"Ingenting meir", not "ingen hendingar".

			By Sunday evening the weekend has one day left and everything on it has finished, so an
			empty page here usually means the weekend is over rather than that nothing was on. Saying
			the second would be wrong about a weekend that may have been full.
		-->
		<p class="weekend__empty">Ingenting meir denne helga.</p>
		<p class="weekend__note">
			Sjå <a href="/hendingar">alt som kjem</a> eller <a href="/kalender">kalenderen</a> — eller
			<a href="/send-inn">send inn ei hending</a> du veit om.
		</p>
	{/if}
</div>

<style>
	.weekend {
		padding-block: clamp(2rem, 5vw, 4rem) var(--section-y);
		container-type: inline-size;
	}
	.weekend__h {
		/* cqw rather than vw, and floored low enough to survive 320px — the rule docs/brand.md
		   records after a shared vw step clipped the hero at both ends of the range. */
		font-size: clamp(1.75rem, 13cqw, 5.5rem);
		margin-block: 0.4rem 0.35rem;
	}
	.weekend__range {
		font-family: var(--font-mono);
		font-size: var(--step-body);
		color: var(--peach-dim);
		margin-block: 0 1.5rem;
	}
	.weekend__count {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--peach-dim);
		margin-block-end: 1.25rem;
	}
	.weekend__empty {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: var(--step-mid);
		max-inline-size: 34ch;
	}
	.weekend__note {
		max-inline-size: 44ch;
		color: var(--peach-dim);
	}
</style>
