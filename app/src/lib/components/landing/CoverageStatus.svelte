<script lang="ts">
	import { formatEventTime } from '@hendingar/core/datetime';
	import { siteStatus } from '../../events.remote';

	/**
	 * What this list actually is, said out loud, directly under it.
	 *
	 * Someone looking at two dozen events has no way to tell whether they are seeing a whole
	 * country or three calendars in one municipality — and /datasamling, which answers that
	 * honestly, is a page most visitors will never open. Guessing wrong in either direction is
	 * costly: they trust an empty result, or dismiss a good one.
	 *
	 * Every number is read from the data, so this cannot drift from the truth the way a sentence
	 * of copy would. Top-level await, so it is in the server-rendered HTML (CLAUDE.md).
	 */
	const status = await siteStatus();

	const where = $derived(
		status.regions.length === 0
			? 'ingen område enno'
			: status.regions.length === 1
				? status.regions[0]
				: `${status.regions.slice(0, -1).join(', ')} og ${status.regions.at(-1)}`
	);
</script>

<aside class="coverage" aria-label="Kva denne lista dekkjer">
	<p class="coverage__line">
		<strong>{status.upcomingCount}</strong> hendingar framover, henta frå
		<strong>{status.sourceCount}</strong>
		{status.sourceCount === 1 ? 'kjelde' : 'kjelder'} i {where}.
		{#if status.lastCollectedAt}
			Sist oppdatert
			<time datetime={status.lastCollectedAt.toISOString()}>
				{formatEventTime(status.lastCollectedAt, 'Europe/Oslo', 'card')}
			</time>.
		{:else}
			Ingen henting har køyrt enno.
		{/if}
	</p>
	<p class="coverage__line coverage__line--muted">
		Dette er ikkje alt som skjer — berre det vi klarer å hente.
		{#if status.linkedCount > 0}
			Vi lenkjer òg til {status.linkedCount} kalendrar vi ikkje hentar frå.
		{/if}
		<a href="/datasamling">Sjå kjeldene →</a>
	</p>
</aside>

<style>
	.coverage {
		border-block-start: var(--rule) solid var(--peach-line);
		padding-block-start: 0.9rem;
		margin-block-start: 1.25rem;
	}
	.coverage__line {
		margin: 0;
		font-size: var(--step-body);
		max-inline-size: 68ch;
	}
	.coverage__line--muted {
		margin-block-start: 0.35rem;
		color: var(--peach-dim);
	}
	.coverage strong {
		font-variant-numeric: tabular-nums;
	}
</style>
