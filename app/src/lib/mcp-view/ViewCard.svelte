<script lang="ts">
	import type { ViewEvent } from '@hendingar/core/public-event';
	import EventThumb from '../components/EventThumb.svelte';
	import { placeOf, timeOf } from './days.ts';

	/**
	 * One event in the MCP App view: the site's own thumbnail, then what and when and where, then
	 * what a person can do about it.
	 *
	 * Every link goes through `open`, which asks the host to open it. The view runs in a sandboxed
	 * frame inside somebody else's chat, and a plain navigation from there is blocked or lands inside
	 * the frame. The `href` stays on each anchor anyway, so the address can be seen and copied.
	 */
	let {
		event,
		open,
		ask,
		wide = false
	}: {
		event: ViewEvent;
		open: (url: string) => void;
		ask: (event: ViewEvent) => void;
		/** The only card in the answer: room for the picture and the description. */
		wide?: boolean;
	} = $props();

	const time = $derived(timeOf(event));
	const place = $derived(placeOf(event));

	function follow(url: string) {
		return (e: MouseEvent) => {
			e.preventDefault();
			open(url);
		};
	}
</script>

<article class="vcard" class:vcard--wide={wide}>
	<a
		class="vcard__thumb"
		href={event.url}
		onclick={follow(event.url)}
		tabindex="-1"
		aria-hidden="true"
	>
		<EventThumb
			id={event.id}
			posterUrl={event.posterUrl}
			title={event.title}
			category={event.category}
			sourceSlugs={event.sources.map((s) => s.slug)}
		/>
	</a>
	<div class="vcard__body">
		<p class="label vcard__kicker">
			{event.categoryLabel}{#if time}<span aria-hidden="true"> · </span>{time}{/if}
		</p>
		<h3 class="vcard__title">
			<a href={event.url} onclick={follow(event.url)}>{event.title}</a>
		</h3>
		{#if place}
			<p class="vcard__place">{place}</p>
		{/if}
		{#if event.weeklyHours}
			<p class="vcard__place">
				{event.weeklyHours.lines.join(' · ')}{#if event.weeklyHours.cadence}
					({event.weeklyHours.cadence}){/if}
			</p>
		{/if}
		{#if wide && event.description}
			<p class="vcard__desc">{event.description}</p>
		{/if}
		<p class="vcard__actions">
			<a class="btn btn--sm" href={event.icsUrl} onclick={follow(event.icsUrl)}>Legg i kalender</a>
			{#if event.ticketUrl}
				<a class="btn btn--sm btn--solid" href={event.ticketUrl} onclick={follow(event.ticketUrl)}
					>Billettar</a
				>
			{/if}
			<button type="button" class="vcard__ask" onclick={() => ask(event)}> Fortel meir </button>
		</p>
		{#if event.sources.length > 0}
			<p class="fineprint vcard__sources">
				Kjelde:
				{#each event.sources as source, i (source.slug)}
					{@const link = source.eventUrl ?? source.siteUrl}
					{#if i > 0},
					{/if}{#if link}<a href={link} onclick={follow(link)}>{source.name}</a
						>{:else}{source.name}{/if}
				{/each}
			</p>
		{:else if event.submittedByReader}
			<p class="fineprint vcard__sources">Sendt inn av ein lesar</p>
		{/if}
	</div>
</article>

<style>
	.vcard {
		display: grid;
		grid-template-columns: 8rem minmax(0, 1fr);
		gap: 0.9rem;
		padding-block: 0.9rem;
		border-block-start: var(--rule) solid var(--peach-line);
	}
	.vcard--wide {
		grid-template-columns: minmax(0, 1fr);
	}
	/* The tile's own 16:9. A square crop cut the generated tiles' lettering off at the edge. */
	.vcard__thumb {
		display: block;
		align-self: start;
		aspect-ratio: 16 / 9;
		overflow: hidden;
	}
	.vcard__thumb :global(.thumb) {
		inline-size: 100%;
		block-size: 100%;
		object-fit: cover;
	}
	.vcard__body {
		min-inline-size: 0;
	}
	.vcard__kicker {
		margin: 0 0 0.2rem;
	}
	.vcard__title {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.15rem;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}
	.vcard__title a {
		color: var(--peach-hi);
		text-decoration: none;
	}
	.vcard__title a:hover,
	.vcard__title a:focus-visible {
		text-decoration: underline;
	}
	.vcard__place {
		margin: 0.2rem 0 0;
		color: var(--peach-dim);
	}
	.vcard__desc {
		margin: 0.6rem 0 0;
		display: -webkit-box;
		-webkit-line-clamp: 6;
		line-clamp: 6;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.vcard__actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.75rem;
		margin: 0.6rem 0 0;
	}
	/* A question, not a destination: quieter than the two buttons that leave the chat. */
	.vcard__ask {
		padding: 0;
		border: 0;
		background: none;
		color: var(--peach-dim);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}
	.vcard__ask:hover,
	.vcard__ask:focus-visible {
		color: var(--peach-hi);
	}
	.vcard__sources {
		margin: 0.5rem 0 0;
	}
</style>
