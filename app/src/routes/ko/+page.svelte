<script lang="ts">
	import {
		VERIFICATION_CHECK_LABELS,
		VERIFICATION_VERDICT_LABELS
	} from '@hendingar/core/verification';
	import { formatEventTime } from '@hendingar/core/datetime';
	import { SUBMISSION_TTL_HOURS } from '@hendingar/core/submissions';
	import { categoryLabel } from '@hendingar/core/taxonomy';
	import { existingClientId } from '../../lib/client-id.ts';
	import { mySubmissions, type QueuedSubmission } from '../../lib/submit.remote';

	/**
	 * Your own submissions, and why each one did or did not go out.
	 *
	 * Client-rendered on purpose, like /hjarta: which submissions are yours is a fact your browser
	 * holds, so the server cannot know it before the page loads and there is nothing to put in the
	 * HTML. Nothing here belongs to a crawler.
	 */
	let loaded = $state(false);
	let rows = $state<QueuedSubmission[]>([]);
	let failed = $state(false);

	$effect(() => {
		const id = existingClientId();
		if (!id) {
			loaded = true;
			return;
		}
		void mySubmissions({ clientId: id })
			.then((result) => {
				rows = result;
			})
			.catch(() => (failed = true))
			.finally(() => (loaded = true));
	});

	const waiting = $derived(rows.filter((r) => r.outcome !== 'approved'));
	const live = $derived(rows.filter((r) => r.outcome === 'approved'));

	const OUTCOME_LABEL: Record<string, string> = {
		approved: 'Ute',
		duplicate: 'Finst frå før',
		shady: 'Stoppa',
		declined: 'Manglar noko'
	};

	/**
	 * What to actually do about it.
	 *
	 * The checks say what went wrong; this says what would fix it. A queue that only reports
	 * failures is a wall with a sign on it — the point of showing somebody their own rejected
	 * submission is that they are the one person who can correct it.
	 */
	const FIX: Record<string, string> = {
		duplicate:
			'Er det verkeleg den same hendinga? Er det ein annan dato eller ein annan stad, rett det og send inn på nytt.',
		declined:
			'Sjå kva kontroll som ikkje gjekk gjennom under, rett det i skjemaet og send inn på nytt.',
		shady:
			'Denne kom ikkje gjennom truverd-kontrollen. Er det ei ekte lokal hending, legg til ei lenkje til arrangøren og fyll ut skildringa.'
	};

	function checkHint(check: QueuedSubmission['checks'][number]): string | null {
		if (check.verdict === 'pass') return null;
		if (check.check === 'corroboration')
			return 'Ei lenkje til arrangøren eller Facebook-hendinga gjer denne sterkare — men ho stoppar deg ikkje.';
		if (check.check === 'normalisation') return 'Sjekk dato, klokkeslett og stad.';
		if (check.check === 'categorisation') return 'Prøv ein annan kategori.';
		if (check.check === 'duplicate') return 'Sjekk om det er ei anna hending enn den vi alt har.';
		return null;
	}
</script>

<svelte:head>
	<title>Kø — hendingar.no</title>
	<!-- Per-visitor, and nobody else's business. -->
	<meta name="robots" content="noindex" />
</svelte:head>

<section class="shell queue">
	<p class="label">Dine innsendingar</p>
	<h1 class="display queue__h">Kø</h1>

	{#if !loaded}
		<p class="queue__note">Hentar innsendingane dine …</p>
	{:else if failed}
		<p class="queue__note">Klarte ikkje hente innsendingane akkurat no. Prøv igjen om litt.</p>
	{:else if rows.length === 0}
		<p class="queue__note">
			Du har ikkje sendt inn noko frå denne nettlesaren enno. Alt du sender inn dukkar opp her, med
			svar på kvifor det gjekk ut eller ikkje — og med høve til å rette det som ikkje gjorde det.
		</p>
		<p><a class="btn btn--solid" href="/send-inn">Send inn ei hending</a></p>
	{:else}
		<p class="queue__note">
			Lagra i denne nettlesaren. Vi veit ikkje kven du er — lista følgjer deg ikkje til ei anna
			maskin, og forsvinn om du tømmer nettlesardata.
		</p>
		<p class="queue__note">
			Ingen sit og går gjennom desse. Ei hending som ikkje kom ut ventar på at du rettar henne —
			gjer du ikkje det innan {SUBMISSION_TTL_HOURS} timar, blir ho sletta. Rettar du henne, byrjar klokka
			på nytt.
		</p>

		{#if waiting.length > 0}
			<h2 class="display display--md queue__section">Ventar på deg</h2>
			<ul class="cards">
				{#each waiting as row (row.id)}
					<li class="card frame" data-outcome={row.outcome}>
						<div class="card__top">
							<span class="pill">{OUTCOME_LABEL[row.outcome ?? 'declined']}</span>
							<span class="card__when">
								{formatEventTime(new Date(row.startsAt), row.venueTimeZone)}
							</span>
						</div>
						<h3 class="display display--sm card__h">{row.title}</h3>
						<p class="card__meta">
							{categoryLabel(row.category)}{row.venueName ? ` · ${row.venueName}` : ''}
						</p>

						{#if row.duplicateOf}
							<p class="card__dupe">
								Vi har henne alt: <a href={row.duplicateOf.path}>{row.duplicateOf.title}</a>
							</p>
						{/if}

						<p class="card__fix">{FIX[row.outcome ?? 'declined']}</p>

						<!-- Only what did not pass. Listing five green checks under "ventar på deg" buries
						     the one line that tells somebody what to change. -->
						{#if row.checks.some((c) => c.verdict !== 'pass')}
							<ul class="reasons">
								{#each row.checks.filter((c) => c.verdict !== 'pass') as check (check.check)}
									<li>
										<span class="reasons__name">{VERIFICATION_CHECK_LABELS[check.check]}</span>
										<span class="reasons__verdict"
											>{VERIFICATION_VERDICT_LABELS[check.verdict]}</span
										>
										<span class="reasons__why">{check.reasoning}</span>
										{#if checkHint(check)}
											<span class="reasons__hint">{checkHint(check)}</span>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}

						<p class="card__actions">
							<a class="btn" href="/send-inn?rett={row.id}">Rett og send inn på nytt</a>
						</p>
					</li>
				{/each}
			</ul>
		{/if}

		{#if live.length > 0}
			<h2 class="display display--md queue__section">Ute på sida</h2>
			<ul class="cards">
				{#each live as row (row.id)}
					<li class="card frame" data-outcome="approved">
						<div class="card__top">
							<span class="pill pill--on">{OUTCOME_LABEL.approved}</span>
							<span class="card__when">
								{formatEventTime(new Date(row.startsAt), row.venueTimeZone)}
							</span>
						</div>
						<h3 class="display display--sm card__h">
							<a href={row.path}>{row.title}</a>
						</h3>
						<p class="card__meta">
							{categoryLabel(row.category)}{row.venueName ? ` · ${row.venueName}` : ''}
						</p>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<style>
	.queue {
		padding-block: var(--section-y);
	}
	.queue__h {
		font-size: clamp(2rem, 7vw, 4rem);
		margin-block: 0.2em 0.5em;
	}
	.queue__note {
		max-inline-size: 58ch;
		color: var(--peach-dim);
		margin-block-end: 1.5rem;
	}
	.queue__section {
		margin-block: 2.5rem 1rem;
	}
	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1rem;
	}
	.card {
		padding: clamp(1rem, 2.5vw, 1.4rem);
		display: grid;
		gap: 0.5rem;
		justify-items: start;
		background: var(--navy-900);
	}
	.card__top {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.pill {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		padding: 0.25em 0.6em;
		border: var(--rule) solid var(--peach-line);
		color: var(--peach-dim);
	}
	.pill--on {
		background: var(--peach);
		color: var(--navy-900);
		border-color: var(--peach);
	}
	.card__when,
	.card__meta {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
		margin: 0;
	}
	.card__h {
		margin: 0;
		font-size: var(--step-mid);
		overflow-wrap: anywhere;
	}
	.card__dupe,
	.card__fix {
		margin: 0;
		font-size: 0.9375rem;
		max-inline-size: 64ch;
	}
	.card__fix {
		color: var(--peach-dim);
	}
	.reasons {
		list-style: none;
		margin: 0.3rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
		inline-size: 100%;
	}
	.reasons li {
		display: grid;
		gap: 0.15rem;
		padding-inline-start: 0.9rem;
		border-inline-start: var(--rule-fat) solid var(--peach-line);
	}
	.reasons__name {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		text-transform: uppercase;
		font-size: 0.9rem;
	}
	.reasons__verdict {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}
	.reasons__why {
		font-size: 0.9375rem;
	}
	.reasons__hint {
		font-size: 0.875rem;
		color: var(--peach-dim);
	}
	.card__actions {
		margin-block-start: 0.4rem;
	}
</style>
