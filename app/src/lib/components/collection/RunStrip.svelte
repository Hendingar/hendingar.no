<script lang="ts">
	import { formatEventTime } from '@hendingar/core/datetime';
	import type { IngestRunSummary } from '../../collection.remote';

	let { runs }: { runs: IngestRunSummary[] } = $props();

	// Oldest on the left reads as a timeline; the query returns newest first.
	const ordered = $derived([...runs].reverse());

	function label(run: IngestRunSummary): string {
		const when = formatEventTime(run.startedAt, 'Europe/Oslo', 'full');
		const counts = `${run.created} nye, ${run.updated} endra, ${run.unchanged} uendra, ${run.rejected} avviste`;
		return `${when} — ${run.status} (${counts})`;
	}
</script>

{#if ordered.length > 0}
	<!--
		Status is encoded by FILL as well as by position, and every bar carries a text label, so the
		strip does not depend on colour alone — the whole palette is one hue, which makes
		colour-only status meaningless here anyway.
	-->
	<ol class="strip" aria-label="Siste køyringar, eldst først">
		{#each ordered as run (run.id)}
			<li class="bar" data-status={run.status} title={label(run)}>
				<span class="visually-hidden">{label(run)}</span>
			</li>
		{/each}
	</ol>

	<ul class="legend">
		<li><span class="swatch" data-status="success"></span> Vellukka</li>
		<li><span class="swatch" data-status="partial"></span> Delvis</li>
		<li><span class="swatch" data-status="failed"></span> Feila</li>
	</ul>
{:else}
	<p class="none">Ingen køyringar registrerte enno.</p>
{/if}

<style>
	.strip {
		display: flex;
		gap: 3px;
		align-items: flex-end;
		list-style: none;
		margin: 0;
		padding: 0;
		block-size: 2.5rem;
	}
	.bar {
		inline-size: 0.7rem;
		block-size: 100%;
		border: var(--rule) solid var(--peach);
	}
	.bar[data-status='success'] {
		background: var(--peach);
	}
	.bar[data-status='partial'] {
		/* Half-filled: distinguishable from solid without a second hue. */
		background: linear-gradient(to top, var(--peach) 50%, transparent 50%);
	}
	.bar[data-status='failed'] {
		background: repeating-linear-gradient(45deg, var(--peach) 0 2px, transparent 2px 5px);
	}
	.bar[data-status='running'] {
		border-style: dashed;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1rem;
		list-style: none;
		margin: 0.6rem 0 0;
		padding: 0;
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.swatch {
		inline-size: 0.7rem;
		block-size: 0.7rem;
		border: var(--rule) solid var(--peach);
	}
	.swatch[data-status='success'] {
		background: var(--peach);
	}
	.swatch[data-status='partial'] {
		background: linear-gradient(to top, var(--peach) 50%, transparent 50%);
	}
	.swatch[data-status='failed'] {
		background: repeating-linear-gradient(45deg, var(--peach) 0 2px, transparent 2px 5px);
	}
	.none {
		color: var(--peach-dim);
		margin: 0;
	}
</style>
