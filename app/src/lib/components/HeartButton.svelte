<script lang="ts">
	import {
		ensureClientId,
		forgetHeart,
		isHearted,
		loadHearts,
		rememberHeart
	} from '../hearts.svelte.ts';
	import { toggleHeart } from '../hearts.remote';

	/**
	 * Heart an event, and show how many others have.
	 *
	 * Optimistic: the tap flips the mark and the count immediately, then tells the server. Waiting
	 * for a round trip to acknowledge a heart makes a listing feel broken on a slow connection, and
	 * the worst case here is a number that was briefly off by one.
	 */
	let {
		eventId,
		hearts = 0,
		size = 'normal'
	}: {
		eventId: number;
		hearts?: number;
		size?: 'normal' | 'large';
	} = $props();

	// Read once on the client. During SSR there is no localStorage, so nothing is hearted yet and
	// the button renders in its resting state — which is also what a crawler should see.
	$effect(() => loadHearts());

	let pending = $state(false);

	/*
	 * Derived from the prop, with a local override once the reader touches it.
	 *
	 * Copying the prop into state would freeze the first value: a listing fetches its counts in bulk
	 * *after* the tiles mount, so every card would sit at zero forever. The override exists only so
	 * an optimistic tap can win over the prop until the server answers.
	 */
	let override = $state<number | null>(null);
	const count = $derived(override ?? hearts);

	const on = $derived(isHearted(eventId));
	const label = $derived(on ? 'Fjern frå hjarta' : 'Legg til i hjarta');

	async function toggle(mouse: MouseEvent) {
		/*
		 * The tile is one big link, so a heart inside it must claim the click for itself or tapping
		 * it navigates to the event instead.
		 */
		mouse.preventDefault();
		mouse.stopPropagation();
		if (pending) return;

		const next = !on;
		const changed = next ? rememberHeart(eventId) : forgetHeart(eventId);
		if (!changed) return;

		override = Math.max(0, count + (next ? 1 : -1));
		pending = true;

		try {
			const result = await toggleHeart({ eventId, clientId: ensureClientId(), hearted: next });
			override = result.hearts;
		} catch {
			/*
			 * Put it back. The reader's own list is the thing they will notice being wrong, so a
			 * failed write must not leave a heart that only exists in this browser.
			 */
			if (next) forgetHeart(eventId);
			else rememberHeart(eventId);
			override = null;
		} finally {
			pending = false;
		}
	}
</script>

<button
	type="button"
	class="heart"
	class:heart--on={on}
	class:heart--large={size === 'large'}
	aria-pressed={on}
	aria-label={label}
	title={label}
	onclick={toggle}
>
	<svg class="heart__mark" viewBox="0 0 24 24" aria-hidden="true">
		<path
			d="M12 20.5s-7.5-4.7-7.5-10A4.5 4.5 0 0 1 12 7.6a4.5 4.5 0 0 1 7.5 2.9c0 5.3-7.5 10-7.5 10z"
		/>
	</svg>
	<!-- Zero is not shown. A count of nothing reads as a judgement on the event rather than as an
	     absence of taps, and every event starts there. -->
	{#if count > 0}
		<span class="heart__n">{count}</span>
	{/if}
</button>

<style>
	.heart {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: none;
		border: 0;
		padding: 0.25rem;
		cursor: pointer;
		color: var(--peach-dim);
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		line-height: 1;
		transition: color 140ms ease;
	}
	.heart:hover,
	.heart:focus-visible {
		color: var(--peach-hi);
	}
	.heart--on {
		color: var(--peach);
	}
	.heart__mark {
		inline-size: 1.15rem;
		block-size: 1.15rem;
		/* Outline until hearted, filled after: the state has to be readable without colour alone. */
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linejoin: round;
		transition: fill 140ms ease;
	}
	.heart--on .heart__mark {
		fill: currentColor;
	}
	.heart--large .heart__mark {
		inline-size: 1.5rem;
		block-size: 1.5rem;
	}
	.heart--large {
		font-size: var(--step-body);
	}
</style>
