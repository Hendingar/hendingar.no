<script lang="ts">
	import {
		VERIFICATION_CHECK_LABELS,
		VERIFICATION_CHECK_QUESTIONS,
		VERIFICATION_VERDICT_LABELS,
		type VerificationCheck,
		type VerificationVerdict
	} from '@hendingar/core/verification';

	type Check = {
		check: VerificationCheck;
		verdict: VerificationVerdict;
		confidence: number;
		reasoning: string;
		deterministic: boolean;
		model: string | null;
	};

	let {
		status,
		summary,
		checks,
		poster = null
	}: {
		status: 'published' | 'pending' | 'rejected';
		summary: string;
		checks: Check[];
		/**
		 * The poster the fields were read from, when the submission came from one.
		 *
		 * Shown with the verdict because this is the moment the reasoning is read: the checks talk
		 * about a title and a time, and the picture is where those came from. It is the same image
		 * held in the browser throughout — nothing new is uploaded, and nothing is stored.
		 */
		poster?: string | null;
	} = $props();

	/**
	 * Move focus here once the verdict exists. The panel is rendered above the form, so a
	 * keyboard or screen-reader user would otherwise submit and be told nothing happened.
	 */
	let panel: HTMLElement | undefined = $state();
	$effect(() => {
		panel?.focus();
	});

	const headline: Record<typeof status, string> = {
		published: 'Publisert',
		pending: 'Til gjennomgang',
		rejected: 'Ikkje publisert'
	};

	const posterCaption: Record<'published' | 'pending' | 'rejected', string> = {
		published: 'Dette er biletet hendinga blei lesen frå.',
		pending: 'Dette er biletet vi las. Eit menneske ser på det same.',
		rejected: 'Dette er biletet vi las.'
	};

	const explanation: Record<typeof status, string> = {
		published: 'Hendinga ligg ute no. Takk — ho er søkbar med ein gong.',
		pending: 'Vi fann noko vi ikkje kunne avgjere maskinelt, så eit menneske ser på henne først.',
		rejected: 'Vi publiserte henne ikkje. Er dette feil, kan du seie frå — vi tek vare på saka.'
	};
</script>

<section bind:this={panel} class="verdict frame" tabindex="-1" aria-labelledby="verdict-h">
	<div class="verdict__head" data-status={status}>
		<p class="label">Resultat</p>
		<h2 class="display display--md" id="verdict-h">{headline[status]}</h2>
		<p class="verdict__lede">{explanation[status]}</p>
		<p class="verdict__summary">{summary}</p>
	</div>

	{#if poster}
		<!--
			The image the reasoning is about.
			
			The checks below talk about a title, a time and a place; this is where those came from.
			Held in the browser throughout — the same data URL the form showed, nothing re-uploaded
			and nothing stored server-side.
		-->
		<figure class="verdict__poster">
			<img src={poster} alt="Biletet du sende inn" />
			<figcaption>{posterCaption[status]}</figcaption>
		</figure>
	{/if}

	<!-- Every check is listed, including the ones that passed. A verdict panel that only shows
	     problems teaches people the system is a gate; showing all five shows what it actually did. -->
	<ol class="verdict__checks">
		{#each checks as check (check.check)}
			<li class="check" data-verdict={check.verdict}>
				<div class="check__top">
					<h3 class="check__name">{VERIFICATION_CHECK_LABELS[check.check]}</h3>
					<span class="check__verdict">{VERIFICATION_VERDICT_LABELS[check.verdict]}</span>
				</div>
				<p class="check__question">{VERIFICATION_CHECK_QUESTIONS[check.check]}</p>
				<p class="check__reasoning">{check.reasoning}</p>
				<p class="check__meta">
					{check.deterministic ? 'Regel' : (check.model ?? 'Modell')}
					<!-- A check that never ran has no confidence to report. "0 % visse" reads as a
					     measurement rather than an absence. -->
					{#if check.confidence > 0}· {check.confidence} % visse{/if}
				</p>
			</li>
		{/each}
	</ol>
</section>

<style>
	.verdict__poster {
		margin: 0;
		border-block-end: var(--rule) solid var(--peach-line);
		background: var(--navy-900);
	}
	.verdict__poster img {
		display: block;
		inline-size: 100%;
		block-size: auto;
		/* Capped, or a portrait photo pushes the five checks — the actual content — off screen. */
		max-block-size: 16rem;
		object-fit: contain;
	}
	.verdict__poster figcaption {
		padding: 0.5rem 0.75rem;
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}

	.verdict {
		display: grid;
		scroll-margin-block-start: 1rem;
	}
	.verdict:focus-visible {
		outline: 2px solid var(--peach);
		outline-offset: 3px;
	}
	.verdict__head {
		padding: clamp(1rem, 3vw, 1.75rem);
		display: grid;
		gap: 0.5rem;
		border-inline-start: var(--rule-fat) solid var(--peach-line);
	}
	.verdict__head[data-status='published'] {
		border-inline-start-color: var(--peach);
	}
	.verdict__head[data-status='pending'] {
		border-inline-start-color: var(--peach-quiet);
	}
	.verdict__lede,
	.verdict__summary {
		margin: 0;
		max-inline-size: 56ch;
	}
	.verdict__summary {
		color: var(--peach-dim);
		font-family: var(--font-mono);
		font-size: 0.875rem;
	}
	.verdict__checks {
		list-style: none;
		margin: 0;
		padding: 0;
		border-block-start: var(--rule) solid var(--peach-line);
	}
	.check {
		padding: clamp(0.85rem, 2.5vw, 1.25rem);
		display: grid;
		gap: 0.3rem;
	}
	.check + .check {
		border-block-start: var(--rule) solid var(--peach-line);
	}
	.check__top {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: baseline;
		justify-content: space-between;
	}
	.check__name {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.875rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.check__verdict {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		padding: 0.2em 0.6em;
		border: var(--rule) solid var(--peach-line);
	}
	.check[data-verdict='pass'] .check__verdict {
		background: var(--peach);
		color: var(--navy-900);
		border-color: var(--peach);
	}
	.check[data-verdict='fail'] .check__verdict {
		background: var(--peach-ghost);
		border-color: var(--peach);
	}
	.check__question,
	.check__meta {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--peach-dim);
	}
	.check__reasoning {
		margin: 0;
		max-inline-size: 62ch;
	}
	.check__meta {
		font-family: var(--font-mono);
	}
</style>
