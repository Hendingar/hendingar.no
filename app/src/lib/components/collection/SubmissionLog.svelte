<script lang="ts">
	import { formatEventTime } from '@hendingar/core/datetime';
	import { eventPath } from '@hendingar/core/slug';
	import { WITHHELD_TITLE } from '@hendingar/core/verification';
	import type { SubmissionLogRow } from '../../collection.remote';

	/**
	 * What people have sent in, and what the checks decided.
	 *
	 * The page used to report a count and nothing else, so the half of the pipeline with a person
	 * in it was invisible: you could audit every imported event and not one submitted one. The
	 * README promises the verification reasoning is auditable rather than a black box, and a
	 * number is not an audit.
	 */
	let { submissions }: { submissions: SubmissionLogRow[] } = $props();

	/*
	 * No label promises a person any more.
	 *
	 * "Til gjennomgang" described a queue somebody would work through, and there is nobody in it —
	 * submissions are decided when they arrive. `pending` survives for imported events from sources
	 * we have not marked trusted, where it honestly means "not checked yet".
	 */
	const STATUS_LABEL: Record<string, string> = {
		published: 'Publisert',
		pending: 'Ventar på kontroll',
		rejected: 'Ikkje publisert'
	};

	const METHOD_LABEL: Record<string, string> = {
		form: 'skjema',
		photo: 'bilete',
		import: 'import'
	};
</script>

{#if submissions.length === 0}
	<p class="empty">
		Ingen innsendingar enno. <a href="/send-inn">Send inn den fyrste</a>.
	</p>
{:else}
	<ol class="log">
		{#each submissions as row (row.id)}
			<li class="entry" data-status={row.status}>
				<time class="entry__when" datetime={row.createdAt.toISOString()}>
					{formatEventTime(row.createdAt, 'Europe/Oslo', 'card')}
				</time>
				<span class="entry__what">
					<span class="entry__title">
						<!-- Rejected submissions are retained as evidence but their text is withheld:
						     republishing what we judged to be spam would defeat rejecting it. -->
						{#if row.status === 'published' && row.title}
							<!--
								The row says an event went out; this is how you go and look at it.

								Only for `published`, because only a published event has a page —
								`getEvent` filters on it, so a link on a pending or rejected row would
								be a 404 offered by us. Those two stay plain text, which is also the
								honest rendering: there is nothing to see yet, or nothing to see.

								A stretched overlay makes the whole row tappable while the accessible
								name stays the title alone. The same idiom as `EventTile`, including
								the reason: wrapping the row would fold the timestamp, the method and
								the verdict into the link's name on every one of them.
							-->
							<a class="entry__link" href={eventPath(row.id, row.title)}>{row.title}</a>
						{:else}
							{row.title ?? WITHHELD_TITLE}
						{/if}
					</span>
					{#if row.notes}
						<span class="entry__notes">{row.notes}</span>
					{/if}
				</span>
				<span class="entry__method">via {METHOD_LABEL[row.method] ?? row.method}</span>
				<span class="entry__status">{STATUS_LABEL[row.status] ?? row.status}</span>
			</li>
		{/each}
	</ol>
{/if}

<style>
	.log {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.entry {
		position: relative;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto auto;
		align-items: baseline;
		gap: 0.6rem 0.9rem;
		padding: 0.75rem 0.25rem;
		border-block-end: var(--rule) solid var(--peach-line);
	}
	/*
	 * The whole row is the target, not the four words of the title.
	 *
	 * `::after` stretched over the positioned row, which is what makes a 44px-tall row tappable on
	 * a phone without wrapping anything else in the link. The row lifts on hover rather than
	 * underlining the title: this is a log, and a list of underlined lines reads as a menu.
	 */
	.entry:has(.entry__link) {
		transition: background var(--dur-fast) ease;
	}
	.entry:hover:has(.entry__link) {
		background: var(--peach-ghost);
	}
	.entry__link {
		color: inherit;
		text-decoration: none;
	}
	.entry__link::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.entry:hover .entry__link {
		color: var(--peach-hi);
	}
	.entry:has(.entry__link:focus-visible) {
		outline: 2px solid var(--peach);
		outline-offset: 2px;
	}
	.entry__link:focus-visible {
		outline: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.entry:has(.entry__link) {
			transition: none;
		}
	}
	.entry__when,
	.entry__method {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--peach-dim);
		white-space: nowrap;
	}
	.entry__what {
		display: grid;
		gap: 0.15rem;
		min-inline-size: 0;
	}
	.entry__title {
		font-family: var(--font-display);
		font-weight: 700;
		font-stretch: 106%;
		font-size: 1rem;
	}
	.entry[data-status='rejected'] .entry__title {
		font-style: italic;
		color: var(--peach-dim);
	}
	.entry__notes {
		font-size: 0.8125rem;
		color: var(--peach-dim);
	}
	.entry__status {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		padding: 0.3em 0.6em;
		border: var(--rule) solid var(--peach-line);
		white-space: nowrap;
	}
	.entry[data-status='published'] .entry__status {
		background: var(--peach);
		color: var(--navy-900);
		border-color: var(--peach);
	}
	.entry[data-status='rejected'] .entry__status {
		background: var(--peach-ghost);
		border-color: var(--peach);
	}
	.empty {
		margin: 0;
		color: var(--peach-dim);
	}

	@media (max-width: 40rem) {
		/* Two rows rather than four squeezed columns: the timestamp and method join the second. */
		.entry {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.entry__what {
			grid-column: 1;
			grid-row: 1;
		}
		.entry__status {
			grid-column: 2;
			grid-row: 1;
		}
		.entry__when {
			grid-column: 1;
			grid-row: 2;
		}
		.entry__method {
			grid-column: 2;
			grid-row: 2;
			text-align: end;
		}
	}
</style>
