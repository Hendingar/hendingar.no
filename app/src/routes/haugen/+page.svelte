<script lang="ts">
	/**
	 * Haugen — every upcoming event in one heap, and a box to ask it something.
	 *
	 * "Konsertar", "noko for ungdom", "ting å gjere ute": the questions a category chip cannot
	 * answer, because they are about who and where and what for rather than what kind. Each event
	 * is asked whether it is what was meant, by TypeSafe's Jev through the verifier, and the ones
	 * that are float up out of the pile (ADR 0022).
	 *
	 * Without JavaScript the box is a GET form and the answer is plain text matching — the same
	 * pile, the same links, no model. A crawler cannot make this page spend anything.
	 */
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { formatEventTime } from '@hendingar/core/datetime';
	import { eventPath } from '@hendingar/core/slug';
	import { searchTermSchema } from '@hendingar/core/search';
	import { COMPARE_MAX_EVENTS, type PileScore } from '@hendingar/core/validation';
	import Pile from '../../lib/components/haugen/Pile.svelte';
	import UnderTheHood from '../../lib/components/haugen/UnderTheHood.svelte';
	import PageMeta from '../../lib/components/PageMeta.svelte';
	import EventThumb from '../../lib/components/EventThumb.svelte';
	import { HAUGEN, SUGGESTIONS } from '../../lib/content/haugen.ts';
	import { FLOAT, pileOrder, type PileMode, type PileTrace } from '../../lib/haugen.ts';
	import { askPile, pile, textAnswer } from '../../lib/haugen.remote';
	import { claimTypedBeforeHydration } from '../../lib/typed-before-hydration.ts';

	const INPUT_ID = 'haugen-q';
	/** Long enough to skip the middle of a word, short enough to feel like it is listening. */
	const DEBOUNCE_MS = 300;

	const balls = await pile();
	const fromUrl = searchTermSchema.parse(untrack(() => page.url.searchParams.get('q') ?? ''));
	const initial = fromUrl ? await textAnswer(fromUrl) : [];

	/*
	 * What is in the box. Whatever the visitor typed before hydration wins over the address bar:
	 * the server-rendered input is live from the moment it lands, and hydration would otherwise
	 * reset it to `?q=` and throw their typing away (lib/typed-before-hydration.ts).
	 */
	let q = $state(claimTypedBeforeHydration().get(INPUT_ID) ?? fromUrl);

	/** The question the current answer is for — which lags `q` while the next one is in flight. */
	let asked = $state(fromUrl);
	let mode = $state<PileMode>('tekst');
	let scores = $state<PileScore[]>(initial);
	let pending = $state(false);
	/** How the current answer was made, and how long it took to reach this browser. */
	let trace = $state<PileTrace | null>(null);
	let clientMs = $state(0);
	/**
	 * When the current question actually left for the server (after the debounce), and how long
	 * ago that is. Null while nothing is in flight. The status line counts it up, so the wait
	 * itself shows what is happening rather than a spinner that says nothing.
	 */
	let sentAt = $state<number | null>(null);
	/** Showing a text answer while asking Jev again in the background. */
	let upgrading = $state(false);
	let waited = $state(0);
	/** The pile is animating — set by the pile once motion is allowed and loaded. */
	let live = $state(false);

	const scoreMap = $derived(new Map(scores.map((s) => [s.eventId, s.score])));
	const asking = $derived(asked.length > 0);
	const ordered = $derived(pileOrder(balls, asking ? scoreMap : new Map()));
	/*
	 * Three events for the 3-vs-3 comparison: the best answer, the one Jev was least sure about
	 * (nearest 0.5), and the least likely. Three different kinds of case, so the two models are
	 * compared where they agree easily and where they might not.
	 */
	const titles = $derived(new Map(balls.map((b) => [b.id, b.title])));
	const picks = $derived.by(() => {
		if (mode !== 'jev' || scores.length < 3) return [];
		const byScore = [...scores].sort((a, b) => b.score - a.score);
		const best = byScore[0];
		const worst = byScore[byScore.length - 1];
		const middle = byScore
			.filter((s) => s !== best && s !== worst)
			.sort((a, b) => Math.abs(a.score - 0.5) - Math.abs(b.score - 0.5))[0];
		return [best, middle, worst]
			.filter((s) => s !== undefined)
			.map((s) => ({ id: s.eventId, title: titles.get(s.eventId) ?? '', score: s.score }));
	});
	/*
	 * Sixty for the wide comparison: the ones Jev found likeliest. Every answer and every unsure
	 * one is in there, and the rest are the near misses — where two models are most likely to
	 * disagree. The bottom of a pile of 120 is "no" to any model and would only pad the count.
	 */
	const widePicks = $derived(
		mode === 'jev'
			? [...scores]
					.sort((a, b) => b.score - a.score)
					.slice(0, COMPARE_MAX_EVENTS)
					.map((s) => ({ id: s.eventId, title: titles.get(s.eventId) ?? '', score: s.score }))
			: []
	);

	const answers = $derived(asking ? ordered.filter((b) => (scoreMap.get(b.id) ?? 0) >= FLOAT) : []);

	/*
	 * Ask as the visitor types, and keep only the newest answer.
	 *
	 * Driven from the input's own events rather than an effect on `q`: asking is a response to
	 * somebody typing, not something derived from state. A sequence number rather than cancelling,
	 * because a remote command cannot be aborted, and an answer to "kon" arriving after the answer
	 * to "konsertar" must not overwrite it.
	 */
	let sequence = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * How long to wait before asking Jev again, after an answer had to come from text matching.
	 *
	 * The text answer is shown at once — a visitor never waits on a retry — and the pile then keeps
	 * working towards the real one. Seventeen seconds in all: a verifier that was restarting (a
	 * deploy, a replica moving) is back well inside that, and a cold start measured 16s.
	 */
	const RETRY_MS = [2_000, 5_000, 10_000];
	let retry: ReturnType<typeof setTimeout> | undefined;

	/**
	 * `force` asks even when the question is the one already answered — which on mount it always
	 * is, because `asked` starts as `?q=`. Without it a reload, or coming back to a search, kept
	 * the server's text matching and never asked Jev: one hit, until the question was reworded.
	 */
	function ask(raw: string, delay = DEBOUNCE_MS, force = false) {
		const term = searchTermSchema.parse(raw);
		clearTimeout(timer);
		clearTimeout(retry);
		upgrading = false;
		const mine = ++sequence;
		if (!term) {
			asked = '';
			sentAt = null;
			scores = [];
			trace = null;
			pending = false;
			return;
		}
		if (term === asked && !pending && !force) return;
		pending = true;
		timer = setTimeout(() => send(term, mine, 0), delay);
	}

	async function send(term: string, mine: number, attempt: number) {
		const started = performance.now();
		const first = attempt === 0;
		if (first) {
			sentAt = started;
			waited = 0;
		}
		try {
			const answer = await askPile({ q: term });
			if (mine !== sequence) return;
			// A retry only ever replaces text with Jev. Another text answer changes nothing on
			// screen, so the balls do not twitch every few seconds while the pile waits.
			if (first || answer.mode === 'jev') {
				mode = answer.mode;
				scores = answer.scores;
				trace = answer.trace;
				clientMs = performance.now() - started;
				asked = term;
			}
			// Text because the model did not answer — not because the budget is spent, which a
			// retry would only spend further — so keep working towards the real answer.
			const delay = RETRY_MS[attempt];
			upgrading =
				answer.mode === 'tekst' && answer.trace.fallback === 'utan-modell' && delay !== undefined;
			if (upgrading && delay !== undefined) {
				retry = setTimeout(() => send(term, mine, attempt + 1), delay);
			}
		} catch {
			// A failed question leaves the pile as it was. The next keystroke asks again.
			if (mine === sequence) upgrading = false;
		} finally {
			if (mine === sequence && first) {
				pending = false;
				sentAt = null;
			}
		}
	}

	// The wait, counted. Ticks only while a question is in flight.
	$effect(() => {
		const from = sentAt;
		if (from === null) return;
		const tick = setInterval(() => (waited = performance.now() - from), 100);
		return () => clearInterval(tick);
	});

	const seconds = (ms: number) => (ms / 1000).toFixed(1).replace('.', ',');

	onMount(() => {
		// Typed before hydration, or arrived with `?q=`: either way the answer on screen is text
		// matching, so ask properly now.
		if (q) ask(q, 0, true);
		return () => {
			clearTimeout(timer);
			clearTimeout(retry);
		};
	});

	function when(ball: (typeof balls)[number]): string {
		return formatEventTime(ball.startsAt, ball.venueTimeZone);
	}
</script>

<PageMeta
	title="Haugen — spør kva som skjer · hendingar.no"
	description="Alt som skjer i Sunnhordland dei neste vekene, i ein haug. Skriv «konsertar», «noko for ungdom» eller «ting å gjere ute», og sjå kva som flyt opp."
	path="/haugen"
/>

<svelte:head>
	{#if fromUrl}
		<!-- A searched pile is a view of the page, not a page. Same rule as /hendingar?q=. -->
		<meta name="robots" content="noindex, follow" />
	{/if}
</svelte:head>

<!--
	The stage: the pile fills the screen, the question sits on top of it.

	Laid out after ShipPile on purpose — a compact title, the heap filling the rest of the viewport,
	and the box over the bottom of the heap, where the eye already is. The heading used to take half
	the screen; the pile is the page, so the pile gets the room.
-->
<section class="stage" class:stage--live={live} aria-labelledby="haugen-h">
	<header class="stage__head">
		<h1 id="haugen-h" class="display stage__h">{HAUGEN.heading}</h1>
		<p class="stage__lede">{HAUGEN.lede(balls.length)}</p>
	</header>

	<div class="stage__pile">
		<Pile balls={ordered} scores={scoreMap} {asking} {mode} {pending} bind:live />
	</div>

	<div class="stage__ask">
		<form class="ask" method="get" action="/haugen" role="search">
			<label class="visually-hidden" for={INPUT_ID}>Kva er du ute etter?</label>
			<input
				id={INPUT_ID}
				name="q"
				type="search"
				autocomplete="off"
				maxlength="80"
				placeholder={HAUGEN.placeholder}
				bind:value={q}
				oninput={() => ask(q)}
			/>
			<button class="btn btn--solid ask__go" type="submit" aria-busy={pending}>
				{#if pending}<span class="spinner" aria-hidden="true"></span>{/if}
				<span class="ask__go-label">Spør</span>
			</button>
		</form>

		<p class="ask__status" aria-live="polite">
			{#if pending && sentAt !== null}
				<span class="ask__working"
					>Jev vurderer {balls.length} hendingar<span class="dots" aria-hidden="true"></span></span
				>
				<strong>{seconds(waited)} s</strong>
			{:else if pending}
				<span class="ask__working">Spør haugen<span class="dots" aria-hidden="true"></span></span>
			{:else if asking && upgrading}
				<!--
					Before "nothing found": text matching finding nothing is not an answer while Jev is
					still being asked. That is precisely the question a model is for.
				-->
				<strong>{answers.length}</strong> av {balls.length} ·
				<span class="ask__working"
					>{HAUGEN.upgrading}<span class="dots" aria-hidden="true"></span></span
				>
			{:else if asking && answers.length === 0}
				{HAUGEN.none}
			{:else if asking && trace?.model}
				<strong>{answers.length}</strong> av {trace.considered} · {Math.round(clientMs)} ms ·
				{trace.inputTokens.toLocaleString('nb-NO')} token · {trace.model}{trace.cached
					? ' · frå mellomlageret'
					: ''}
				· <a href="#panser">sjå korleis</a>
			{:else if asking}
				<strong>{answers.length}</strong> av {balls.length} · {HAUGEN.textOnly}
			{/if}
		</p>

		<ul class="ask__chips" aria-label="Forslag">
			{#each SUGGESTIONS as suggestion (suggestion)}
				<li>
					<a
						class="ask__chip"
						class:ask__chip--on={asked === suggestion}
						href={`/haugen?q=${encodeURIComponent(suggestion)}`}
						onclick={(e) => {
							e.preventDefault();
							q = suggestion;
							ask(suggestion, 0);
						}}>{suggestion}</a
					>
				</li>
			{/each}
		</ul>
	</div>
</section>

<div class="shell below">
	{#if answers.length > 0}
		<!--
			The answers as words. A round thumbnail carries no title, and on a phone the pile is a
			picture; this is what somebody actually reads to decide.
		-->
		<h2 class="below__h">{HAUGEN.answers(answers.length)} på «{asked}»</h2>
		<ol class="answers">
			{#each answers as ball (ball.id)}
				<li>
					<a class="answer" href={eventPath(ball.id, ball.title)}>
						<span class="answer__thumb">
							<EventThumb
								id={ball.id}
								posterUrl={ball.posterUrl}
								posterSrcset={ball.posterSrcset}
								title={ball.title}
								category={ball.category}
								sourceSlugs={ball.sourceSlugs}
								sizes="3.5rem"
							/>
						</span>
						<span class="answer__text">
							<span class="answer__title">{ball.title}</span>
							<span class="answer__meta"
								>{when(ball)}{ball.venueName ? ` · ${ball.venueName}` : ''}</span
							>
						</span>
						{#if mode === 'jev'}
							<span
								class="answer__score"
								title="Kor sikker haugen er på at dette er det du spør etter"
								>{Math.round((scoreMap.get(ball.id) ?? 0) * 100)} %</span
							>
						{/if}
					</a>
				</li>
			{/each}
		</ol>
	{/if}

	{#if asking && trace}
		<div id="panser">
			<UnderTheHood
				{trace}
				{clientMs}
				query={asked}
				{picks}
				{widePicks}
				scores={scores.map((s) => s.score)}
			/>
		</div>
	{/if}
</div>

<style>
	/*
	 * The stage is the viewport under the masthead. Without JavaScript it is an ordinary column —
	 * title, box, a wrapped grid of balls — because a fixed-height box that cannot animate would
	 * just crop the pile.
	 */
	.stage {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding-block: 1.5rem 2rem;
		container-type: inline-size;
	}

	.stage--live {
		position: relative;
		display: grid;
		grid-template-rows: auto 1fr;
		block-size: calc(100svh - 7rem);
		min-block-size: 32rem;
		padding-block: 1.25rem 0;
		gap: 0;
	}

	.stage__head {
		padding-inline: var(--gutter);
		text-align: center;
	}

	.stage__h {
		margin: 0;
		font-size: clamp(1.6rem, 4.2cqw, 3rem);
		line-height: 0.95;
	}

	.stage__lede {
		margin: 0.35rem auto 0;
		max-inline-size: 48ch;
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}

	.stage__pile {
		min-block-size: 0;
		padding-inline: clamp(0.5rem, 2vw, 1.5rem);
	}

	.stage__ask {
		order: -1;
		inline-size: min(40rem, 100% - 2 * var(--gutter));
		margin-inline: auto;
	}

	/* Over the bottom of the heap, where the eye already is. */
	.stage--live .stage__ask {
		position: absolute;
		inset-block-end: 1.25rem;
		inset-inline-start: 50%;
		translate: -50% 0;
		z-index: 3;
		order: 0;
	}

	.ask {
		display: flex;
		gap: 0.5rem;
		padding: 0.4rem;
		background: var(--navy-900);
		border: var(--rule) solid var(--peach);
		border-radius: 0.9rem;
		box-shadow: 0 0.75rem 2rem rgb(0 0 0 / 40%);
	}

	.ask input {
		flex: 1;
		min-inline-size: 0;
		padding: 0.6rem 0.8rem;
		font: inherit;
		font-size: var(--step-body);
		color: var(--peach-hi);
		background: transparent;
		border: 0;
	}

	.ask input:focus-visible {
		outline: none;
	}

	.ask:focus-within {
		outline: var(--rule-fat) solid var(--peach-hi);
		outline-offset: 2px;
	}

	.ask .btn {
		border-radius: 0.6rem;
	}

	.ask__go {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.spinner {
		inline-size: 0.9em;
		block-size: 0.9em;
		border: 2px solid currentColor;
		border-inline-end-color: transparent;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	/* Three dots that fill in turn: "vurderer…" visibly still going, in text rather than a shape. */
	.dots::after {
		content: '';
		display: inline-block;
		inline-size: 1.5ch;
		text-align: start;
		animation: dots 1.2s steps(4, end) infinite;
	}

	.ask__working {
		color: var(--peach);
	}

	@keyframes spin {
		to {
			rotate: 1turn;
		}
	}

	@keyframes dots {
		0% {
			content: '';
		}
		25% {
			content: '.';
		}
		50% {
			content: '..';
		}
		75% {
			content: '...';
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner,
		.dots::after {
			animation: none;
		}

		.dots::after {
			content: '…';
		}
	}

	.ask__status {
		inline-size: fit-content;
		max-inline-size: 100%;
		min-block-size: 1.4em;
		margin: 0.5rem auto 0;
		padding: 0.15rem 0.7rem;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		text-align: center;
		color: var(--peach-dim);
		/* Solid, not a shadow: over a heap of posters a shadow is not enough to read on. */
		background: var(--navy-900);
		border-radius: 999px;
	}

	.ask__status:empty {
		visibility: hidden;
	}

	.ask__status strong {
		color: var(--peach-hi);
	}

	.ask__status a {
		color: var(--peach);
	}

	.ask__chips {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.4rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	/* One line that scrolls sideways on a phone, rather than wrapping off the bottom of the stage. */
	@media (width < 40rem) {
		.ask__chips {
			flex-wrap: nowrap;
			justify-content: flex-start;
			overflow-x: auto;
			scrollbar-width: none;
		}
	}

	.ask__chip {
		display: inline-block;
		white-space: nowrap;
		padding: 0.25rem 0.7rem;
		font-size: var(--step-micro);
		color: var(--peach);
		text-decoration: none;
		background: var(--navy-900);
		border: var(--rule) solid var(--peach-line);
		border-radius: 999px;
	}

	.ask__chip:hover,
	.ask__chip--on {
		color: var(--navy-900);
		background: var(--peach);
		border-color: var(--peach);
	}

	.below {
		padding-block: 2rem var(--section-y);
	}

	.below__h {
		margin: 0 0 0.75rem;
		font-size: var(--step-mid);
		color: var(--peach-hi);
	}

	.answers {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
		max-inline-size: 44rem;
	}

	.answer {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 0.4rem;
		color: inherit;
		text-decoration: none;
		border-radius: 999px;
	}

	.answer:hover {
		background: var(--peach-wash-2);
	}

	.answer__thumb {
		flex: none;
		inline-size: 3.5rem;
		aspect-ratio: 1;
		overflow: hidden;
		border-radius: 50%;
	}

	.answer .answer__thumb > :global(*) {
		inline-size: 100%;
		block-size: 100%;
		aspect-ratio: auto;
		object-fit: cover;
		border: 0;
	}

	.answer__text {
		flex: 1;
		min-inline-size: 0;
	}

	.answer__title {
		display: block;
		color: var(--peach-hi);
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}

	.answer__meta {
		display: block;
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}

	.answer__score {
		flex: none;
		padding-inline-end: 0.75rem;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach);
	}
</style>
