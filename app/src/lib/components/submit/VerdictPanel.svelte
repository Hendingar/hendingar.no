<script lang="ts">
	import {
		VERIFICATION_CHECK_LABELS,
		VERIFICATION_CHECK_QUESTIONS,
		VERIFICATION_VERDICT_LABELS,
		type VerificationCheck,
		type VerificationVerdict
	} from '@hendingar/core/verification';
	import { formatEventTime } from '@hendingar/core/datetime';
	import { SUBMISSION_TTL_HOURS } from '@hendingar/core/submissions';
	import {
		CONTRIBUTABLE_FIELD_LABELS,
		type ContributableField
	} from '@hendingar/core/contribution';
	import { linkLabel, safeHttpUrl } from '../../source-link.ts';

	type Check = {
		check: VerificationCheck;
		verdict: VerificationVerdict;
		confidence: number;
		reasoning: string;
		deterministic: boolean;
		model: string | null;
	};

	type Outcome = 'approved' | 'duplicate' | 'shady' | 'declined' | 'contributed';

	let {
		status,
		outcome,
		duplicateOf = null,
		summary,
		checks,
		poster = null,
		sourceUrl = null,
		contributed = []
	}: {
		status: 'published' | 'pending' | 'rejected';
		/** What we concluded, which is the part the sender actually needs told. */
		outcome: Outcome;
		/** The event we already had, when this was a duplicate. Named, never merely alleged. */
		duplicateOf?: {
			title: string;
			path: string;
			startsAt: Date | string;
			venueName: string | null;
			venueTimeZone: string | null;
		} | null;
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
		/**
		 * The page the sender said the event came from, when they gave one.
		 *
		 * Shown with the verdict because the checks are about whether this is real, and the link is
		 * the one thing on the panel that lets somebody go and look. It matters most when the
		 * answer was no: the sender needs to see which URL we actually judged, not the one they
		 * meant to paste.
		 */
		sourceUrl?: string | null;
		/**
		 * The fields this submission filled on the event named in `duplicateOf`.
		 *
		 * Listed rather than summarised, because it is the only receipt a contributor gets. They
		 * gave up their own listing to improve someone else's row, and "takk for bidraget" without
		 * saying what landed is indistinguishable from a polite refusal.
		 */
		contributed?: readonly ContributableField[];
	} = $props();

	/* Re-checked at the href rather than trusted: see source-link.ts. */
	const safeSource = $derived(safeHttpUrl(sourceUrl));

	/**
	 * Move focus here once the verdict exists. The panel is rendered above the form, so a
	 * keyboard or screen-reader user would otherwise submit and be told nothing happened.
	 */
	let panel: HTMLElement | undefined = $state();
	$effect(() => {
		panel?.focus();
	});

	/*
	 * Five outcomes, five different things to say.
	 *
	 * There used to be three statuses, one of which meant "a person will look at it" — and with
	 * nobody in the queue that was a slower no that nobody was told about. "No, this is spam",
	 * "no, we already have it" and "no, we could not read the date" are three different messages,
	 * and only the last two deserve an apology.
	 *
	 * `contributed` is the only one of the five that is not about whether a listing was created.
	 * The sender chose to improve an event we already had, so the headline is about what they did
	 * rather than about what we decided — anything shaped like "ikkje publisert" would report their
	 * contribution as a refusal.
	 */
	const headline: Record<Outcome, string> = {
		approved: 'Publisert',
		duplicate: 'Vi har henne alt',
		shady: 'Ikkje publisert',
		declined: 'Ikkje publisert',
		contributed: 'Takk — hendinga blei betre'
	};

	/*
	 * Every "no" says what happens next, because there is no queue and nobody coming.
	 *
	 * The route forward is the sender's own: correct it in /kø and send it again. If they do not,
	 * it is deleted — and saying so is the honest half of not keeping other people's abandoned
	 * drafts forever. The number comes from core so this copy cannot drift from the sweep that
	 * actually does the deleting.
	 */
	const explanation: Record<Outcome, string> = {
		approved: 'Hendinga ligg ute no. Takk — ho er søkbar med ein gong.',
		duplicate:
			'Denne hendinga står her frå før, så vi la henne ikkje ut på nytt. Innsendinga er teken vare på og kreditert kjelda under.',
		/*
		 * No apology, and no explanation of the rule.
		 *
		 * This is the one outcome where the sender is not somebody we have failed, and explaining
		 * what triggered it would be a guide to getting round it. It still says what happens next,
		 * because a person wrongly caught here deserves to know the door is not locked.
		 */
		shady: `Dette ser ikkje ut som ei ekte lokal hending, så vi la henne ikkje ut. Ho ligg i køen din i ${SUBMISSION_TTL_HOURS} timar om du vil rette henne.`,
		declined: `Noko kom ikkje gjennom kontrollane, så vi la henne ikkje ut. Sjå kva som feila under, rett det og send inn på nytt — du finn henne i køen din. Rører du henne ikkje på ${SUBMISSION_TTL_HOURS} timar, blir ho sletta.`,
		/*
		 * No apology and no "but", because nothing went wrong.
		 *
		 * A contribution creates no listing on purpose — there was already one — so the sentence
		 * has to make clear that is the *point* and not a consolation. What it fills is named
		 * below, since a thank-you that does not say what landed reads exactly like a polite no.
		 */
		contributed:
			'Du sa det var same hending som ei vi har, så innsendinga di gjorde den betre i staden for å bli lagt ut på nytt. Ingenting som stod der frå før blei endra.'
	};

	/*
	 * The captions differ because what happens to the image differs.
	 *
	 * Only an approved event keeps one. For every other outcome the picture never left the browser
	 * a second time — so the caption says that, rather than leaving somebody to wonder what we did
	 * with their photograph.
	 *
	 * "Biletet du sende inn", not "biletet vi las": an image is no longer necessarily one the model
	 * read. It can be one attached to a form somebody typed themselves, or one whose read failed,
	 * and telling either of those people we read it would be a small lie in the receipt.
	 */
	const posterCaption: Record<Outcome, string> = {
		approved: 'Dette er biletet du sende inn. Det blir miniatyrbilete på kortet.',
		duplicate: 'Dette er biletet du sende inn. Det blei ikkje lagra.',
		shady: 'Dette er biletet du sende inn. Det blei ikkje lagra.',
		declined: 'Dette er biletet du sende inn. Det blei ikkje lagra.',
		/*
		 * The one non-approved outcome that can keep a picture, and only into a gap.
		 *
		 * Hedged on purpose: the upload is a second request that has not necessarily finished when
		 * this renders, and it lands only while the event still has no poster. Promising it outright
		 * would be a claim this panel is not in a position to make.
		 */
		contributed:
			'Dette er biletet du sende inn. Manglar hendinga eit bilete, er det ditt som blir brukt.'
	};
</script>

<section bind:this={panel} class="verdict frame" tabindex="-1" aria-labelledby="verdict-h">
	<div class="verdict__head" data-status={status} data-outcome={outcome}>
		<p class="label">Resultat</p>
		<h2 class="display display--md" id="verdict-h">{headline[outcome]}</h2>
		<p class="verdict__lede">{explanation[outcome]}</p>
		<p class="verdict__summary">{summary}</p>
		{#if safeSource}
			<p class="verdict__source">
				Kjelda du oppgav:
				<a href={safeSource} rel="noopener nofollow ugc">{linkLabel(safeSource)}</a>
			</p>
		{/if}
		{#if outcome !== 'approved'}
			<p class="verdict__next"><a href="/ko">Sjå køen din →</a></p>
		{/if}
	</div>

	{#if (outcome === 'duplicate' || outcome === 'contributed') && duplicateOf}
		<!--
			Name the event, do not merely allege it.

			Being told your submission was a copy of something, without being told of what, is
			indistinguishable from being told no for no reason — and it removes the one thing the
			sender could do about it, which is look and see whether we are right.

			The same block serves a contribution, because it is the same fact — the canonical row this
			submission is about. Only the sentence under it differs: for a duplicate it invites a
			correction, and for a contribution it reports what landed.
		-->
		<aside class="dupe">
			<p class="label">
				{outcome === 'contributed' ? 'Hendinga du gjorde betre' : 'Hendinga vi har frå før'}
			</p>
			<a class="dupe__link" href={duplicateOf.path}>{duplicateOf.title}</a>
			<p class="dupe__meta">
				<!-- Separator inside the expression: a bare "·" between an {#if} and its text gets
				     collapsed at the boundary, and the time ran straight into the venue name. -->
				{formatEventTime(
					typeof duplicateOf.startsAt === 'string'
						? new Date(duplicateOf.startsAt)
						: duplicateOf.startsAt,
					duplicateOf.venueTimeZone
				) + (duplicateOf.venueName ? ` · ${duplicateOf.venueName}` : '')}
			</p>
			{#if outcome === 'contributed'}
				{#if contributed.length > 0}
					<!--
						The receipt. Field by field, because this is all a contributor gets: they gave up
						their own listing to fill somebody else's nulls, and a summary would leave them
						unable to tell whether it worked.
					-->
					<ul class="dupe__gave">
						{#each contributed as field (field)}
							<li>{CONTRIBUTABLE_FIELD_LABELS[field]}</li>
						{/each}
					</ul>
					<p class="dupe__note">Dette kom frå deg. Resten stod der frå før.</p>
				{:else}
					<p class="dupe__note">
						Alt du sende stod der frå før, så ingenting blei endra — men vi har notert at du
						stadfesta henne uavhengig.
					</p>
				{/if}
			{:else}
				<p class="dupe__note">
					Er dette ei anna hending? Sei frå, så ser vi på det — vi har teke vare på innsendinga di.
				</p>
			{/if}
		</aside>
	{/if}

	{#if poster}
		<!--
			The image the reasoning is about.
			
			The checks below talk about a title, a time and a place; this is where those came from.
			Held in the browser throughout — the same data URL the form showed, nothing re-uploaded
			and nothing stored server-side.
		-->
		<figure class="verdict__poster">
			<img src={poster} alt="Biletet du sende inn" />
			<figcaption>{posterCaption[outcome]}</figcaption>
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
	.verdict__source {
		margin: 0.75rem 0 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
		/* A host has no spaces, so a long one would push the panel wider than its column. */
		overflow-wrap: anywhere;
	}
	.verdict__next {
		margin: 0.75rem 0 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
	}
	/*
	 * The event we already had, set apart from the verdict copy.
	 *
	 * A left rule rather than a box: it is a citation, not a second verdict, and boxing it would
	 * compete with the panel it sits inside.
	 */
	.dupe {
		margin: 0 clamp(1rem, 3vw, 1.75rem) 1.25rem;
		padding-inline-start: 1rem;
		border-inline-start: var(--rule-fat) solid var(--peach-line);
		display: grid;
		gap: 0.35rem;
	}
	.dupe__link {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 112%;
		text-transform: uppercase;
		font-size: var(--step-mid);
		line-height: 1;
		overflow-wrap: anywhere;
	}
	.dupe__meta {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}
	/*
	 * The fields a contribution filled, as a row of marks rather than a bulleted list.
	 *
	 * There are at most six and each is one word, so a stacked list would be six lines of mostly
	 * whitespace where a reader wants to see the whole answer at a glance.
	 */
	.dupe__gave {
		list-style: none;
		margin: 0.35rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.4rem;
	}
	.dupe__gave li {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		padding: 0.2em 0.6em;
		background: var(--peach);
		color: var(--navy-900);
	}
	.dupe__note {
		margin: 0.3rem 0 0;
		font-size: 0.875rem;
		color: var(--peach-dim);
	}

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
		/* Declared on every row so flagging one cannot shift the text of the other four. */
		border-inline-start: var(--rule-fat) solid transparent;
	}
	/*
	 * The checks that did not pass are the ones the eye should land on.
	 *
	 * All five stay listed, in order — showing only the problems would teach people the system is
	 * a gate rather than five stated questions. But nothing marked them out, so finding the reason
	 * a submission was refused meant reading five paragraphs to see which one was bad news.
	 */
	.check[data-verdict='fail'],
	.check[data-verdict='uncertain'] {
		border-inline-start-color: var(--peach);
		background: var(--peach-ghost);
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
	/*
	 * Filled means "look at this", so it belongs on the checks that stopped the submission — it
	 * used to be the other way round, which made five passes shout and the one refusal whisper.
	 */
	.check[data-verdict='pass'] .check__verdict {
		color: var(--peach-dim);
		border-color: var(--peach-line);
	}
	.check[data-verdict='fail'] .check__verdict,
	.check[data-verdict='uncertain'] .check__verdict {
		background: var(--peach);
		color: var(--navy-900);
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
