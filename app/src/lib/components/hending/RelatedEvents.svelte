<script lang="ts">
	import { formatCalendarDate } from '@hendingar/core/datetime';
	import { categoryLabel } from '@hendingar/core/taxonomy';
	import EventGrid from '../EventGrid.svelte';
	import { relatedEvents } from '../../events.remote';
	import { heartCounts } from '../../hearts.remote';
	import { listingHref } from '../../listing-url.ts';

	/**
	 * The bottom of an event page: the same day, the same calendar, the same kind of thing.
	 *
	 * Each group is the head of a page that already exists, and says so with a link, so this is a
	 * way onward rather than a recommender. A group with nothing in it is left out rather than
	 * shown empty, and the whole section with it — a quiet source on a quiet day says nothing.
	 *
	 * Top-level await, so the tiles are in the server-rendered HTML (CLAUDE.md): a crawler that
	 * lands on one event finds its way to the rest from here.
	 */
	let { eventId }: { eventId: number } = $props();

	const related = await relatedEvents(eventId);
	const all = [...related.sameDay, ...related.sameSource, ...related.sameCategory];
	const hearts = Object.fromEntries(
		(await heartCounts(all.map((e) => e.id))).map((h) => [h.eventId, h.hearts])
	);

	type Group = {
		key: string;
		heading: string;
		more: string;
		href: string;
		events: typeof all;
	};

	const groups: Group[] = [];
	if (related.day) {
		groups.push({
			key: 'dag',
			heading: `Same dag · ${formatCalendarDate(related.day).toLowerCase()}`,
			more: 'Heile dagen',
			href: `/kalender/${related.day}`,
			events: related.sameDay
		});
	}
	if (related.source) {
		groups.push({
			key: 'kjelde',
			heading: `Meir frå ${related.source.name}`,
			more: 'Alle frå kjelda',
			href: listingHref({ kjelde: related.source.slug }),
			events: related.sameSource
		});
	}
	const kind = categoryLabel(related.category).toLowerCase();
	groups.push({
		key: 'kategori',
		heading: `Meir ${kind}`,
		more: `Alt innan ${kind}`,
		href: listingHref({ kategori: related.category }),
		events: related.sameCategory
	});
	const shown = groups.filter((g) => g.events.length > 0);
</script>

{#if shown.length > 0}
	<section class="related" aria-labelledby="h-related">
		<h2 id="h-related" class="related__h">Kanskje òg noko for deg</h2>
		{#each shown as group (group.key)}
			<section class="related__group" aria-labelledby="h-related-{group.key}">
				<header class="related__top">
					<h3 id="h-related-{group.key}" class="related__sub label">{group.heading}</h3>
					<a class="related__more" href={group.href}>{group.more} →</a>
				</header>
				<EventGrid events={group.events} {hearts} />
			</section>
		{/each}
	</section>
{/if}

<style>
	.related {
		margin-block-start: clamp(2.5rem, 6vw, 4rem);
		padding-block-start: 1.25rem;
		border-block-start: var(--rule) solid var(--peach-line);
		display: grid;
		gap: clamp(1.75rem, 4vw, 2.5rem);
	}
	.related__h {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: clamp(1.25rem, 3cqw, 1.75rem);
		line-height: 1;
		text-transform: uppercase;
	}
	.related__group {
		display: grid;
		gap: 0.9rem;
	}
	.related__top {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}
	.related__sub {
		margin: 0;
	}
	.related__more {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach);
	}
</style>
