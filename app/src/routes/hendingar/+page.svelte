<script lang="ts">
	import { listEvents } from '../../lib/events.remote';
	import { categoryLabel } from '@hendingar/core/taxonomy';

	const upcoming = listEvents({ limit: 100 });
</script>

<svelte:head>
	<title>Alle hendingar — hendingar.no</title>
</svelte:head>

<main class="shell">
	<p class="label">Full liste</p>
	<h1 class="display">Alle hendingar</h1>

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

	<p><a href="/">Tilbake</a></p>
</main>

<style>
	main {
		padding-block: var(--section-y);
	}
	h1 {
		font-size: var(--step-huge);
		margin-block: 0.5rem 2rem;
	}
	ul {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 0;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.25rem;
		align-items: baseline;
		padding-block: 1rem;
		border-block-start: var(--rule) solid var(--peach-line);
	}
	strong {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 115%;
		text-transform: uppercase;
		font-size: var(--step-mid);
	}
	span,
	time {
		font-size: var(--step-micro);
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
</style>
