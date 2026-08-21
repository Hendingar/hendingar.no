<script lang="ts">
	import { listEvents } from '#lib/events.remote';
	import { categoryLabel } from '@hendingar/core/taxonomy';

	const upcoming = listEvents({ limit: 20 });
</script>

<svelte:head>
	<title>hendingar.no</title>
</svelte:head>

<h1>Kva skjer?</h1>

{#if upcoming.error}
	<p>Kunne ikkje laste hendingar.</p>
{:else if upcoming.loading}
	<p>Lastar…</p>
{:else if upcoming.current}
	{#if upcoming.current.length === 0}
		<p>Ingen hendingar enno.</p>
	{:else}
		<ul>
			{#each upcoming.current as event (event.id)}
				<li>
					<strong>{event.title}</strong>
					<span>{categoryLabel(event.category)}</span>
					{#if event.venueName}<span>{event.venueName}</span>{/if}
					<time datetime={event.startsAt.toISOString()}>
						{event.startsAt.toLocaleString('nn-NO', { timeZone: 'Europe/Oslo' })}
					</time>
				</li>
			{/each}
		</ul>
	{/if}
{/if}
