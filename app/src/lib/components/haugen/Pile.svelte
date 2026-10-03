<script lang="ts">
	/**
	 * The heap of round thumbnails on `/haugen`, and the answers floating out of it.
	 *
	 * Two renderings of one list, and the list is the truth:
	 *
	 * - **Static** — server-rendered, without JavaScript, and for anyone who prefers reduced
	 *   motion. A wrapped row of round links, answers first. Everything works; nothing moves.
	 * - **Live** — once mounted, and only if motion is welcome. The same links, positioned by
	 *   `pile-physics.ts`: they fall into a heap, the answers to a question float up out of it, and
	 *   a mouse can pick one up and throw it.
	 *
	 * The DOM order is the ranking in both (`pileOrder`), so a keyboard or a screen reader walks the
	 * answers best first whatever the physics happens to have done with them on screen.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { formatEventTime } from '@hendingar/core/datetime';
	import { eventPath } from '@hendingar/core/slug';
	import { categoryLabel } from '@hendingar/core/taxonomy';
	import EventThumb from '../EventThumb.svelte';
	import { FLOAT, SINK, buoyancy, type PileMode, type Scores } from '../../haugen.ts';
	import { BallStage, PileWorld, ballSizing, ballVariance } from '../../pile-physics.ts';
	import type { PileBall } from '../../haugen.remote';
	import { surfaceOf, track } from '../../analytics.ts';

	let {
		balls,
		scores,
		asking,
		mode,
		live = $bindable(false)
	}: {
		/** Already in pile order — answers first. */
		balls: PileBall[];
		scores: Scores;
		/** A question is being answered, so scores mean something. */
		asking: boolean;
		/** Who answered. Text matching scores 1 or 0, which is not worth printing as a percentage. */
		mode: PileMode;
		/** Out: the pile is animating. The page lays itself out around a live pile differently. */
		live?: boolean;
	} = $props();

	const showScores = $derived(asking && mode === 'jev');

	/*
	 * The card beside a ball, on hover or keyboard focus.
	 *
	 * One card for the pile rather than one per ball: a hundred hidden cards are a hundred times the
	 * markup for something only ever shown once. Placed when it opens, from where the ball is at
	 * that moment, and flipped to the left near the right edge so it never leaves the pile.
	 */
	let wrap: HTMLDivElement | undefined = $state();
	let card = $state<{ ball: PileBall; x: number; y: number; flip: boolean } | null>(null);

	/** The hovered ball's element, so the card can follow it while the pile is still moving. */
	let cardTarget: HTMLElement | null = null;

	function openCard(ball: PileBall, el: HTMLElement) {
		if (held) return;
		cardTarget = el;
		card = { ball, ...cardPosition(el) };
	}

	function cardPosition(el: HTMLElement) {
		const outer = wrap?.getBoundingClientRect();
		const rect = el.getBoundingClientRect();
		if (!outer) return { x: 0, y: 0, flip: false };
		const right = rect.right - outer.left;
		const flip = right + 300 > outer.width;
		return {
			x: flip ? rect.left - outer.left : right,
			y: rect.top - outer.top + rect.height / 2,
			flip
		};
	}

	function closeCard(id: number) {
		if (card?.ball.id !== id) return;
		card = null;
		cardTarget = null;
	}

	let box: HTMLOListElement | undefined = $state();
	let width = $state(0);
	let height = $state(0);

	let world: PileWorld | null = null;
	const stage = new BallStage();
	let frame = 0;
	let last = 0;

	const scoreOf = (id: number) => scores.get(id) ?? 0;

	const sizing = $derived(live && width > 0 ? ballSizing(width, height, balls.length) : null);

	/**
	 * Live, the pile shows as many as fit at a readable size, in pile order — so when a question
	 * is asked, answers from later in the fortnight come in and the least relevant leave.
	 */
	const shown = $derived(sizing ? balls.slice(0, sizing.capacity) : balls);

	function radiusOf(id: number, base: number): number {
		if (!asking) return base * ballVariance(id);
		const score = scoreOf(id);
		// Answers swell and the rest shrink a little: the pile makes room for what was asked for.
		const emphasis = score >= FLOAT ? 1.3 : score < SINK ? 0.8 : 1;
		return base * ballVariance(id) * emphasis;
	}

	function tick(now: number) {
		frame = 0;
		if (!world) return;
		world.step(last ? now - last : 16);
		last = now;
		for (const pose of world.poses()) stage.place(pose);
		if (card && cardTarget) card = { ball: card.ball, ...cardPosition(cardTarget) };
		// A settled pile asks for no frames at all; anything that disturbs it calls `run` again.
		if (!world.settled) frame = requestAnimationFrame(tick);
		else last = 0;
	}

	function run() {
		if (!frame && world) frame = requestAnimationFrame(tick);
	}

	onMount(() => {
		if (!box) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		let cancelled = false;
		const observer = new ResizeObserver(([entry]) => {
			if (!entry) return;
			width = entry.contentRect.width;
			height = entry.contentRect.height;
			world?.resize(width, height);
			run();
		});

		// Only matter-js is loaded late: it is the weight, and a visitor who prefers reduced
		// motion never downloads it.
		import('matter-js').then((mod) => {
			if (cancelled || !box) return;
			// matter-js is a CommonJS bundle; depending on how it was pre-bundled the namespace
			// arrives as the default export or as the module itself.
			const matter = 'default' in mod && mod.default ? mod.default : mod;
			live = true;
			width = box.clientWidth;
			height = box.clientHeight;
			world = new PileWorld(matter, width, height);
			observer.observe(box);
		});

		return () => {
			cancelled = true;
			observer.disconnect();
			if (frame) cancelAnimationFrame(frame);
			world?.destroy();
			world = null;
		};
	});

	// Hand the world the balls it should hold, their sizes, and how hard each is lifted.
	$effect(() => {
		if (!live || !world || !sizing) return;
		const specs = shown.map((b) => ({ id: b.id, radius: radiusOf(b.id, sizing.radius) }));
		for (const spec of specs) stage.size(spec.id, spec.radius);
		world.sync(specs);
		world.setLift(
			new Map(asking ? shown.map((b) => [b.id, buoyancy(scoreOf(b.id))] as const) : [])
		);
		// Place every ball at once, so a newly added one is never seen at the corner.
		for (const pose of world.poses()) stage.place(pose);
		run();
	});

	/*
	 * Picking a ball up, with a mouse or a pen.
	 *
	 * Not with a finger: on a phone a drag over the pile is how somebody scrolls past it, and a pile
	 * that swallowed that gesture would trap the page. A tap still opens the event.
	 */
	let held: { id: number; x: number; y: number; moved: boolean } | null = null;
	let swallowClick = false;

	function local(event: PointerEvent) {
		const rect = box?.getBoundingClientRect();
		return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
	}

	function onpointerdown(event: PointerEvent, id: number) {
		if (!world || event.pointerType === 'touch' || event.button !== 0) return;
		const { x, y } = local(event);
		held = { id, x, y, moved: false };
		card = null;
		cardTarget = null;
		world.grab(id, x, y);
		box?.setPointerCapture(event.pointerId);
		run();
	}

	function onpointermove(event: PointerEvent) {
		if (!held || !world) return;
		const { x, y } = local(event);
		if (Math.hypot(x - held.x, y - held.y) > 6) held.moved = true;
		world.drag(x, y);
		run();
	}

	function onpointerup() {
		if (!held || !world) return;
		// A throw is not a click. Without this, letting go of a ball you dragged opens its page.
		swallowClick = held.moved;
		held = null;
		world.release();
		run();
	}

	function onclickcapture(event: MouseEvent) {
		if (!swallowClick) return;
		swallowClick = false;
		event.preventDefault();
		event.stopPropagation();
	}

	function label(ball: PileBall): string {
		const when = formatEventTime(ball.startsAt, ball.venueTimeZone);
		return [ball.title, when, ball.venueName].filter(Boolean).join(' · ');
	}
</script>

<div class="pile-wrap" bind:this={wrap}>
	<ol
		class="pile"
		class:pile--live={live}
		class:pile--asking={asking}
		bind:this={box}
		onpointermove={live ? onpointermove : undefined}
		onpointerup={live ? onpointerup : undefined}
		onpointercancel={live ? onpointerup : undefined}
		onclickcapture={live ? onclickcapture : undefined}
		aria-label="Hendingar i haugen"
	>
		{#each shown as ball (ball.id)}
			{@const score = scoreOf(ball.id)}
			<li
				{@attach stage.register(ball.id)}
				class="ball"
				class:ball--answer={asking && score >= FLOAT}
				class:ball--sunk={asking && score < SINK}
				style:--d={live && sizing ? `${2 * radiusOf(ball.id, sizing.radius)}px` : undefined}
				onpointerdown={(e) => onpointerdown(e, ball.id)}
				onpointerenter={(e) => e.pointerType !== 'touch' && openCard(ball, e.currentTarget)}
				onpointerleave={() => closeCard(ball.id)}
				onfocusin={(e) => openCard(ball, e.currentTarget)}
				onfocusout={() => closeCard(ball.id)}
			>
				<a
					class="ball__link"
					href={eventPath(ball.id, ball.title)}
					title={label(ball)}
					aria-label={label(ball)}
					draggable="false"
					onclick={() =>
						track('select_content', {
							content_type: 'event',
							event_id: ball.id,
							category: ball.category,
							list_name: surfaceOf(page.url.pathname)
						})}
				>
					<span class="ball__face">
						<EventThumb
							id={ball.id}
							posterUrl={ball.posterUrl}
							posterSrcset={ball.posterSrcset}
							title={ball.title}
							category={ball.category}
							sourceSlugs={ball.sourceSlugs}
							sizes="7rem"
						/>
					</span>
				</a>
				{#if showScores && score >= FLOAT}
					<span class="ball__score" aria-hidden="true">{Math.round(score * 100)} %</span>
				{/if}
			</li>
		{/each}
	</ol>

	{#if card}
		{@const c = card.ball}
		{@const score = scores.get(c.id)}
		<div
			class="card"
			class:card--flip={card.flip}
			style:inset-inline-start={`${card.x}px`}
			style:inset-block-start={`${card.y}px`}
			aria-hidden="true"
		>
			<p class="card__title">
				<strong>{c.title}</strong>
				{#if c.sourceNames.length}<span class="card__source">frå {c.sourceNames.join(', ')}</span
					>{/if}
			</p>
			<p class="card__when">
				{formatEventTime(c.startsAt, c.venueTimeZone)}{c.venueName
					? ` · ${c.venueName}`
					: ''}{c.municipality ? `, ${c.municipality}` : ''}
			</p>
			{#if c.blurb}<p class="card__blurb">{c.blurb}</p>{/if}
			<p class="card__foot">
				<span>{categoryLabel(c.category)}</span>
				{#if showScores && score !== undefined}<span class="card__score"
						>{Math.round(score * 100)} % sikker</span
					>{/if}
			</p>
		</div>
	{/if}
</div>

<style>
	.pile-wrap {
		position: relative;
		block-size: 100%;
	}

	.pile {
		margin: 0;
		padding-inline: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		justify-content: center;
		padding-block: 1rem;
	}

	.pile--live {
		position: relative;
		display: block;
		padding: 0;
		/* The stage decides the height; the pile fills it. */
		block-size: 100%;
		overflow: hidden;
		touch-action: pan-y;
		user-select: none;
	}

	.pile .ball {
		display: block;
		inline-size: 4.5rem;
		aspect-ratio: 1;
		border-radius: 50%;
		transition:
			opacity var(--dur-slow) var(--ease-out),
			filter var(--dur-slow) var(--ease-out);
	}

	.pile--live .ball {
		position: absolute;
		inset-block-start: 0;
		inset-inline-start: 0;
		inline-size: var(--d, 4.5rem);
		cursor: grab;
		will-change: transform;
		transition:
			inline-size var(--dur-slow) var(--ease-spring),
			opacity var(--dur-slow) var(--ease-out),
			filter var(--dur-slow) var(--ease-out);
	}

	.pile--live .ball:active {
		cursor: grabbing;
	}

	.pile .ball__link {
		display: block;
		inline-size: 100%;
		block-size: 100%;
		border-radius: 50%;
		outline-offset: 3px;
	}

	.pile .ball__face {
		transform: rotate(var(--turn, 0rad));
		display: block;
		inline-size: 100%;
		block-size: 100%;
		overflow: hidden;
		border-radius: 50%;
		background: var(--navy-900);
		box-shadow: 0 0 0 2px var(--navy-800);
	}

	/*
	 * Whatever EventThumb rendered — a poster, a painting, a fixture or a pattern — fills the
	 * circle. Three classes deep on purpose: the thumbnail's own `.thumb` rule is scoped, and a
	 * scoped rule on the same element would otherwise win on order alone.
	 */
	.pile .ball .ball__face > :global(*) {
		display: block;
		inline-size: 100%;
		block-size: 100%;
		aspect-ratio: auto;
		object-fit: cover;
		border: 0;
		pointer-events: none;
	}

	.pile .ball__score {
		position: absolute;
		inset-block-start: calc(100% + 0.3rem);
		inset-inline-start: 50%;
		translate: -50% 0;
		padding: 0.1rem 0.45rem;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		line-height: 1.4;
		color: var(--peach-hi);
		white-space: nowrap;
		background: var(--navy-900);
		border-radius: 999px;
		pointer-events: none;
	}

	.pile:not(.pile--live) .ball {
		position: relative;
		margin-block-end: 1.6rem;
	}

	.card {
		position: absolute;
		z-index: 2;
		inline-size: min(19rem, 80vw);
		margin-inline-start: 0.75rem;
		padding: 0.9rem 1.1rem;
		translate: 0 -50%;
		color: var(--peach-dim);
		background: var(--navy-900);
		border: var(--rule) solid var(--peach-line);
		border-radius: 0.9rem;
		box-shadow: 0 1rem 2.5rem rgb(0 0 0 / 35%);
		pointer-events: none;
		animation: card-in var(--dur-fast) var(--ease-out);
	}

	.card--flip {
		margin-inline-start: -0.75rem;
		translate: -100% -50%;
	}

	.card p {
		margin: 0;
	}

	.card__title {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.15rem 0.5rem;
	}

	.card__title strong {
		font-size: var(--step-body);
		color: var(--peach-hi);
	}

	.card__source,
	.card__when,
	.card__foot {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
	}

	.card__when {
		margin-block-start: 0.2rem;
	}

	.card__blurb {
		margin-block: 0.6rem;
		line-height: 1.45;
	}

	.card__foot {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-block-start: 0.4rem;
	}

	.card__score {
		color: var(--peach);
	}

	@keyframes card-in {
		from {
			opacity: 0;
		}
	}

	.pile .ball--answer .ball__face {
		box-shadow:
			0 0 0 2px var(--navy-800),
			0 0 0 5px var(--peach);
	}

	.pile .ball--sunk {
		opacity: 0.45;
		filter: grayscale(0.7);
	}

	.pile .ball__link:focus-visible {
		outline: var(--rule-fat) solid var(--peach-hi);
	}

	@media (prefers-reduced-motion: reduce) {
		.pile .ball {
			transition: none;
		}
	}
</style>
