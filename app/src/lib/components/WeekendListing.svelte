<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import {
		DEFAULT_TIME_ZONE,
		formatWeekendRange,
		nextWeekendDates,
		weekendAhead
	} from '@hendingar/core/datetime';
	import type { WeekendChoice } from '@hendingar/core/validation';
	import { eventPath } from '@hendingar/core/slug';
	import EventsByDay from './EventsByDay.svelte';
	import PageMeta from './PageMeta.svelte';
	import { localDayKey } from '../calendar.ts';
	import { canonicalUrl } from '../origin.ts';
	import { breadcrumbJsonLd, itemListJsonLd, jsonLdScript } from '../jsonld.ts';
	import { weekendEvents } from '../events.remote';
	import { heartCounts } from '../hearts.remote';

	/**
	 * Both weekend pages, from one file.
	 *
	 * `/denne-helga` and `/neste-helg` differ in three dates, a heading and one sentence of empty
	 * copy; everything else — the query, the day grouping, the hearts, the JSON-LD, the tabs — is
	 * the same page twice. Two route files would have been two copies of a hundred lines, and a
	 * copy is how the second page quietly stops getting the fixes the first one gets.
	 *
	 * A component rather than a `+layout.svelte` with two children, which is how `/poppis` shares
	 * its two orderings: a layout would force the pair under a common path segment, and
	 * `/denne-helga` and `/neste-helg` are the URLs a person would actually send to somebody.
	 */
	let { which }: { which: WeekendChoice } = $props();

	/**
	 * Top-level await, not a `.loading` flag — this is public content and has to be in the
	 * server-rendered HTML for crawlers and for readers without JavaScript (CLAUDE.md).
	 *
	 * `untrack`, because capturing the initial value is exactly what is wanted here and svelte-check
	 * is right to ask. Each route renders this component with a literal — `/denne-helga` never
	 * becomes `/neste-helg` without a navigation — so there is no later value to miss. A filter
	 * would be the opposite case, and `/hendingar` records why: a top-level await there captures
	 * the filter once and the list never changes again.
	 */
	const events = await weekendEvents(untrack(() => which));
	const hearts = Object.fromEntries(
		(await heartCounts(events.map((e) => e.id))).map((h) => [h.eventId, h.hearts])
	);

	/*
	 * The same dates the query used, worked out again here rather than returned alongside the rows.
	 *
	 * Both helpers are pure and cheap, and a page that derives its own heading from today cannot
	 * print a range that disagrees with the rows it is showing — which a value carried through the
	 * query could, if the two were computed either side of midnight.
	 */
	const today = $derived(localDayKey(new Date(), DEFAULT_TIME_ZONE));
	const dates = $derived(which === 'neste' ? nextWeekendDates(today) : weekendAhead(today));
	const range = $derived(formatWeekendRange(dates));

	const heading = $derived(which === 'neste' ? 'Neste helg' : 'Denne helga');
	const path = $derived(which === 'neste' ? '/neste-helg' : '/denne-helga');

	/**
	 * Two real links, always both shown, each marked when it is the one you are on.
	 *
	 * The same pattern `/poppis` uses for its two orderings, and for the same reason: each is a
	 * thing you can send someone, both work with scripting off, and `aria-current` is what tells a
	 * screen reader which is showing — colour alone says it to sighted readers only.
	 */
	const TABS = [
		{ href: '/denne-helga', label: 'Denne helga' },
		{ href: '/neste-helg', label: 'Neste helg' }
	] as const;

	const jsonLd = $derived([
		itemListJsonLd(
			`Hendingar i Sunnhordland ${which === 'neste' ? 'neste helg' : 'denne helga'}`,
			events.map((e) => canonicalUrl(page.url, eventPath(e.id, e.title)))
		),
		breadcrumbJsonLd([
			{ name: 'Framsida', url: canonicalUrl(page.url, '/') },
			{ name: heading, url: canonicalUrl(page.url, path) }
		])
	]);
</script>

<PageMeta
	title={`${heading} — hendingar.no`}
	description={which === 'neste'
		? 'Alt som skjer i Sunnhordland neste helg, fredag til sundag. Planlegg veka som kjem.'
		: 'Alt som skjer i Sunnhordland denne helga, fredag til sundag. Konsertar, gudstenester, marknader og turar, samla frå lokale kalendrar.'}
	{path}
/>

<svelte:head>
	{#each jsonLd as node, i (i)}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON.stringify output, escaped in jsonLdScript -->
		{@html `<script type="application/ld+json">${jsonLdScript(node)}</${'script'}>`}
	{/each}
</svelte:head>

<div class="shell weekend">
	<!--
		"Helg i Sunnhordland", not "fredag til sundag".

		The second is only true on a Friday. By Sunday `/denne-helga` is showing one day, and an
		eyebrow promising three above a heading that delivers one is the kind of small lie that makes
		a reader distrust the rest. The exact days are on the line under the heading, where they can
		change without contradicting anything.
	-->
	<p class="label">Helg i Sunnhordland</p>
	<h1 class="display weekend__h">{heading}</h1>
	<!--
		The dates, always.

		This is what makes the pair honest rather than a guess the reader has to make. "Denne helga"
		on a Saturday means the weekend you are standing in; "neste helg" means the one after. Both
		are ordinary Norwegian and neither is precise on its own — the range under the heading is.
	-->
	<p class="weekend__range">{range}</p>

	<nav class="tabs" aria-label="Kva helg">
		{#each TABS as tab (tab.href)}
			<a
				class="tab"
				class:tab--on={tab.href === path}
				href={tab.href}
				aria-current={tab.href === path ? 'page' : undefined}
			>
				{tab.label}
			</a>
		{/each}
	</nav>

	{#if events.length > 0}
		<p class="weekend__count">
			{events.length === 1 ? 'Éi hending' : `${events.length} hendingar`}
		</p>
		<!-- headingLevel 2 so each day nests under this page's h1. -->
		<EventsByDay {events} {hearts} headingLevel={2} />
	{:else if which === 'neste'}
		<!--
			A week out, empty means "not collected yet" — not "nothing is on".

			Most sources publish a fortnight ahead at most, and the ingest runs daily, so next
			weekend genuinely fills up as it approaches. Saying "ingenting skjer" about a weekend
			nobody has announced yet would be wrong about the region rather than about our data.
		-->
		<p class="weekend__empty">Ingenting registrert for neste helg enno.</p>
		<p class="weekend__note">
			Vi hentar inn kvar dag, så det kjem som regel meir etter kvart. Sjå
			<a href="/denne-helga">denne helga</a> i mellomtida — eller
			<a href="/send-inn">send inn ei hending</a> du veit om.
		</p>
	{:else}
		<!--
			"Ingenting meir", not "ingen hendingar".

			By Sunday evening the weekend has one day left and everything on it has finished, so an
			empty page here usually means the weekend is over rather than that nothing was on. Saying
			the second would be wrong about a weekend that may have been full.
		-->
		<p class="weekend__empty">Ingenting meir denne helga.</p>
		<p class="weekend__note">
			Sjå <a href="/neste-helg">neste helg</a> eller <a href="/hendingar">alt som kjem</a> — eller
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

	/* `.tab` itself is a shared primitive in brand.css — /poppis uses the same strip. */
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0;
		margin-block-end: 1.75rem;
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
