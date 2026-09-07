<script lang="ts">
	import { untrack } from 'svelte';
	import { claimTypedBeforeHydration } from '../../typed-before-hydration.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { eventPath } from '@hendingar/core/slug';
	import { formatEventTime } from '@hendingar/core/datetime';
	import { dropFirstToken } from '@hendingar/core/search';
	import { searchSuggestions, type SearchSuggestions } from '../../events.remote';
	import {
		hiddenFilterFields,
		listingHref,
		withFilter,
		type FilterToken,
		type ListingFilters
	} from '../../listing-url.ts';

	/**
	 * The listing's whole filter: one field.
	 *
	 * Forty chips — sixteen categories and twenty-three calendars — used to sit above the events,
	 * about 480px of control on a phone before a single event was visible. They are gone. What
	 * replaces them is a field you type into, which offers places, kinds, calendars and named
	 * events at once, and turns whichever you pick into a token you can take off again.
	 *
	 * **It is a GET form first and a combobox second, and that order is the design.** Every token
	 * is a link, the field submits to `/hendingar?q=…` with nothing but HTML, and the suggestions
	 * are an enhancement on top. That is the same rule the chips were built to (#81, and the note
	 * at the top of this route): a filter has to be a URL to be shareable and server-rendered.
	 *
	 * The cost, named honestly in the sketch that settled this: nothing is discoverable until you
	 * type. That is paid off by opening the list on focus with the biggest categories and the
	 * busiest venues in it — the one thing the chip rows genuinely did well.
	 */
	let {
		filters,
		tokens,
		/** How many events the current filter holds, for the placeholder. */
		total
	}: {
		filters: ListingFilters;
		tokens: FilterToken[];
		total: number;
	} = $props();

	const INPUT_ID = 'hendingar-sok';
	const LISTBOX_ID = 'hendingar-forslag';

	/*
	 * What the field holds.
	 *
	 * Seeded from the URL so a shared `?q=jazz` shows "jazz" in the box, and then adopted from the
	 * DOM: this page is server-rendered and the input is usable the moment the HTML lands, which is
	 * before the bundle has hydrated it. Writing `filters.q` over that would erase whatever was
	 * typed in the gap — the bug `typed-before-hydration.ts` exists for, measured at 20ms idle and
	 * 320ms on a busy machine. A component's `<script>` runs before its own template is hydrated,
	 * so this is the last moment the DOM still holds it.
	 */
	let term = $state(untrack(() => filters.q) ?? '');
	let field = $state<HTMLInputElement | undefined>();
	/*
	 * Read in the component's `<script>`, which is the last moment the DOM still holds what somebody
	 * typed before this component's template was hydrated — see `typed-before-hydration.ts` for the
	 * measurement and the bug it was written for.
	 */
	const typedBefore = claimTypedBeforeHydration().get(INPUT_ID);
	if (typedBefore) term = typedBefore;

	/*
	 * ...and then follows the address bar, but only when the address bar actually moves.
	 *
	 * Accepting a suggestion navigates: picking a venue out of "bremnes jul" lands on
	 * `?stad=Bremnes kyrkje&q=jul`, and the field must end up holding "jul" rather than the word
	 * that has just become a token. Back and forward have to move it too.
	 *
	 * Latched on the whole URL rather than on `filters.q`, which was the first attempt and was
	 * wrong in the commonest case: accepting the only word you typed leaves `q` absent both before
	 * and after, so "did q change" answered no and the field kept a word that was now a token
	 * beside it. Typing never changes the URL, so this cannot fight the keyboard.
	 */
	let seenUrl = $state(untrack(() => page.url.href));
	$effect(() => {
		const href = page.url.href;
		if (href === seenUrl) return;
		seenUrl = href;
		term = filters.q ?? '';
		suggestions = null;
		requested = '';
	});

	let open = $state(false);
	let active = $state(-1);
	let suggestions = $state<SearchSuggestions | null>(null);
	let wrapper = $state<HTMLElement | undefined>();
	let requested = $state('');

	/**
	 * One row of the list: what it says, and where pressing it goes.
	 *
	 * Every option is a real address, which is what lets Enter, a click and a middle-click all mean
	 * the same thing — and what keeps the whole control a set of links rather than a set of
	 * handlers that happen to change some state.
	 */
	type Option = { id: string; kind: string; label: string; hint: string; href: string };

	/*
	 * Accepting a suggestion consumes the word that produced it.
	 *
	 * Suggestions match on the first token, so picking "Bremnes kyrkje" out of "bremnes jul" leaves
	 * `stad=Bremnes kyrkje` and `q=jul`. Keeping the whole query would filter twice on the same
	 * word and put a token on screen that duplicates text still in the box.
	 */
	function accepting(key: 'stad' | 'kategori' | 'kjelde', value: string): string {
		const rest = dropFirstToken(term);
		return listingHref(withFilter(withFilter(filters, 'q', rest), key, value));
	}

	const options = $derived.by((): Option[] => {
		const found = suggestions;
		if (!found) return [];
		const list: Option[] = [];

		for (const venue of found.venues) {
			list.push({
				id: `stad-${venue.name}`,
				kind: 'Stad',
				label: venue.name,
				hint: String(venue.total),
				href: accepting('stad', venue.name)
			});
		}
		for (const category of found.categories) {
			list.push({
				id: `kategori-${category.slug}`,
				kind: 'Kategori',
				label: category.label,
				hint: String(category.total),
				href: accepting('kategori', category.slug)
			});
		}
		for (const source of found.sources) {
			list.push({
				id: `kjelde-${source.slug}`,
				kind: 'Kjelde',
				label: source.name,
				hint: String(source.total),
				href: accepting('kjelde', source.slug)
			});
		}
		for (const event of found.events) {
			list.push({
				id: `hending-${event.id}`,
				kind: 'Hending',
				label: event.title,
				hint: formatEventTime(event.startsAt, event.venueTimeZone, 'card'),
				href: eventPath(event.id, event.title)
			});
		}
		/*
		 * The free-text row is last and always there when something is typed.
		 *
		 * It is the answer to "none of these are what I meant", and it carries the count so that
		 * pressing it is never a leap in the dark — including when the count is zero, which is a
		 * useful thing to learn before you press rather than after.
		 */
		if (found.searching) {
			list.push({
				id: 'fritekst',
				kind: 'Søk',
				label: `«${term.trim()}» overalt`,
				hint: String(found.total),
				href: listingHref(withFilter(filters, 'q', term))
			});
		}
		return list;
	});

	let timer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Ask, but not on every keystroke.
	 *
	 * 180ms is below the point at which a list feels laggy and above the rate a person types at, so
	 * a five-letter word costs one request rather than five. The guard on `requested` is what stops
	 * a slow answer for "kyr" painting itself over a newer one for "kyrkje".
	 */
	function ask(next: string) {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			const asked = next.trim();
			requested = asked;
			try {
				const found = await searchSuggestions(asked);
				if (requested === asked) suggestions = found;
			} catch {
				// A suggestion list that cannot load is a missing courtesy, not a broken page: the
				// field still submits, and the listing behind it is still there.
				suggestions = null;
			}
		}, 180);
	}

	/*
	 * Somebody typed before the JavaScript arrived, so catch up with them.
	 *
	 * Two mechanisms, because they cover different halves of the same gap. The claim above reads
	 * the DOM in this component's script — before its template is hydrated, which is the moment
	 * hydration would otherwise write the empty state back over the box. This effect covers the
	 * narrower case where the value survived to mount anyway.
	 *
	 * Adopting the value is only half of it either way: the list is driven by the `input` event,
	 * and that event has already been and gone, so without the `ask` the field would sit holding
	 * their word and offering nothing until they typed another character.
	 */
	$effect(() => {
		const element = untrack(() => field);
		const typed = element?.value || typedBefore;
		/*
		 * Focused before hydration counts too, and is the commoner case on a phone.
		 *
		 * Tapping the field focuses it natively; the `focus` handler does not exist yet, and no
		 * second focus event is coming, because it is already focused. Without this the list would
		 * never open for anyone who reached the field faster than the bundle did — the same class
		 * of gap as the typing one, and it is what made two e2e specs flake before it was
		 * understood.
		 */
		const focusedAlready =
			typeof document !== 'undefined' &&
			element !== undefined &&
			document.activeElement === element;
		if (!typed && !focusedAlready) return;

		if (typed && typed !== untrack(() => term)) term = typed;
		if (untrack(() => suggestions)) return;
		open = true;
		ask(untrack(() => term));
	});

	function onInput(event: Event) {
		term = (event.currentTarget as HTMLInputElement).value;
		active = -1;
		open = true;
		ask(term);
	}

	function onFocus() {
		open = true;
		// The empty-query answer is the biggest categories and the busiest venues — what the chip
		// rows used to say out loud, now said once, on demand.
		if (!suggestions) ask(term);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			// Stops any browser from also treating Escape as "revert this field".
			event.preventDefault();
			open = false;
			active = -1;
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (options.length === 0) return;
			event.preventDefault();
			open = true;
			/*
			 * -1 is the input itself, and it is part of the cycle rather than a floor: arrowing
			 * past the last option returns you to what you typed, which is where you go to edit it.
			 */
			const next = active + (event.key === 'ArrowDown' ? 1 : -1);
			active = next < -1 ? options.length - 1 : next >= options.length ? -1 : next;
			return;
		}
		if (event.key === 'Enter' && active >= 0) {
			// A highlighted option wins over the form's own submit; without this, Enter would run
			// the free-text search while the reader was looking at a highlighted venue.
			event.preventDefault();
			choose(options[active]!);
		}
	}

	function choose(option: Option) {
		open = false;
		active = -1;
		void goto(option.href);
	}

	/*
	 * Closing on blur has to survive the click that follows it.
	 *
	 * `relatedTarget` is the element focus is moving TO, so a click on an option keeps the list
	 * open long enough for that click to land. A plain `onblur` closes it first and the click hits
	 * nothing — the oldest bug in autocomplete.
	 */
	function onBlur(event: FocusEvent) {
		const next = event.relatedTarget;
		if (next instanceof Node && wrapper?.contains(next)) return;
		open = false;
		active = -1;
	}

	const showList = $derived(open && options.length > 0);
	const activeId = $derived(active >= 0 ? options[active]?.id : undefined);
	const placeholder = $derived(
		total === 1 ? 'Søk i éi hending' : `Søk i ${total} hendingar — tittel, stad eller arrangør`
	);
</script>

<!--
	`role="search"` on the form, not on a div: this IS the page's search, and a screen reader user
	navigating by landmark should find it as one.
-->
<form
	bind:this={wrapper}
	class="finder"
	method="GET"
	action="/hendingar"
	role="search"
	onsubmit={() => (open = false)}
>
	<div class="finder__field" class:finder__field--open={showList}>
		{#each tokens as token (token.key)}
			<!--
				A token is a link that removes itself. Not a button: with scripting off it still has
				to work, and "the same page minus this filter" is an address like any other.
			-->
			<span class="token">
				<span class="token__kind">{token.kind}</span>
				<span class="token__label">{token.label}</span>
				<a class="token__x" href={token.removeHref} aria-label={`Fjern filteret ${token.label}`}>
					<span aria-hidden="true">×</span>
				</a>
			</span>
		{/each}

		<!--
			Everything except the query, carried through a no-JavaScript submit. Without these,
			searching from a page filtered to Musikk would quietly drop the category.
		-->
		{#each hiddenFilterFields(filters) as field (field.name)}
			<input type="hidden" name={field.name} value={field.value} />
		{/each}

		<!--
			`type="text"`, not `type="search"`.

			A search input clears itself on Escape — a native default action — which fired the input
			handler, which reopened the list that very key had just closed. `enterkeyhint` keeps the
			one thing the search type was worth here: a phone keyboard with a Search key on it.
		-->
		<input
			bind:this={field}
			id={INPUT_ID}
			class="finder__input"
			type="text"
			enterkeyhint="search"
			name="q"
			value={term}
			{placeholder}
			autocomplete="off"
			role="combobox"
			aria-expanded={showList}
			aria-controls={LISTBOX_ID}
			aria-autocomplete="list"
			aria-activedescendant={activeId}
			aria-label="Søk i hendingar"
			oninput={onInput}
			onfocus={onFocus}
			onkeydown={onKeydown}
			onblur={onBlur}
		/>

		<button class="finder__go" type="submit">Søk</button>
	</div>

	{#if showList}
		<!--
			The listbox is JavaScript-only by nature — it appears in answer to typing — so it is the
			one part of this control that a no-JS visitor never sees. They still get the field, the
			tokens and the results.
		-->
		<ul class="sugg" id={LISTBOX_ID} role="listbox" aria-label="Forslag">
			{#each options as option, index (option.id)}
				<li
					id={option.id}
					class="sugg__row"
					class:sugg__row--active={index === active}
					role="option"
					aria-selected={index === active}
				>
					<a
						class="sugg__link"
						href={option.href}
						tabindex="-1"
						onclick={() => {
							open = false;
							active = -1;
						}}
					>
						<span class="sugg__kind">{option.kind}</span>
						<span class="sugg__label">{option.label}</span>
						<span class="sugg__hint">{option.hint}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</form>

<style>
	.finder {
		position: relative;
		margin-block-end: clamp(1.25rem, 3vw, 2rem);
	}
	.finder__field {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.5rem 0.5rem 0.85rem;
		border: var(--rule) solid var(--peach-line);
		background: color-mix(in srgb, var(--navy-900) 55%, transparent);
	}
	.finder__field:focus-within {
		border-color: var(--peach);
	}
	/* Square with the list below it, so the two read as one control rather than two stacked ones. */
	.finder__field--open {
		border-block-end-color: transparent;
	}

	.token {
		display: inline-flex;
		align-items: baseline;
		gap: 0.45em;
		background: var(--peach);
		color: var(--navy-900);
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		padding: 0.35em 0.35em 0.35em 0.6em;
	}
	.token__kind {
		font-weight: 400;
		opacity: 0.62;
	}
	.token__label {
		/* A venue name is not shouted — it is a proper noun, and 23 characters of tracked capitals
		   is a paragraph. */
		text-transform: none;
		letter-spacing: 0.04em;
	}
	.token__x {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		/* 24px of target inside a 26px token: small, but it sits beside its own label rather than
		   among other targets, and the whole token is only ever removed on purpose. */
		inline-size: 1.5em;
		block-size: 1.5em;
		color: var(--navy-900);
		text-decoration: none;
		font-size: 1.1em;
		line-height: 1;
	}
	.token__x:hover {
		background: var(--navy-900);
		color: var(--peach);
	}

	.finder__input {
		flex: 1 1 12rem;
		min-inline-size: 0;
		background: none;
		border: 0;
		outline: none;
		color: var(--peach);
		font-family: var(--font-mono);
		font-size: var(--step-body);
		padding: 0.55rem 0;
	}
	.finder__input::placeholder {
		color: var(--peach-quiet);
	}

	.finder__go {
		flex: none;
		background: var(--peach);
		border: 0;
		color: var(--navy-900);
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		padding: 0.85em 1.4em;
		cursor: pointer;
	}
	.finder__go:hover {
		background: var(--peach-hi);
	}

	.sugg {
		position: absolute;
		inset-inline: 0;
		z-index: 5;
		list-style: none;
		margin: 0;
		padding: 0;
		border: var(--rule) solid var(--peach);
		background: var(--navy-900);
		max-block-size: 60vh;
		overflow-y: auto;
	}
	.sugg__row + .sugg__row {
		border-block-start: var(--rule) solid var(--peach-line);
	}
	.sugg__link {
		display: grid;
		grid-template-columns: 5.5rem minmax(0, 1fr) auto;
		align-items: baseline;
		gap: 0.75rem;
		padding: 0.6rem 0.85rem;
		text-decoration: none;
		color: var(--peach);
	}
	.sugg__row--active,
	.sugg__link:hover {
		background: var(--peach-ghost);
	}
	.sugg__kind {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--peach-quiet);
	}
	.sugg__label {
		overflow-wrap: anywhere;
	}
	.sugg__hint {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
		font-variant-numeric: tabular-nums;
	}

	@media (width < 34rem) {
		.sugg__link {
			/* The kind moves above the label rather than stealing a third of a 350px row. */
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 0.15rem 0.6rem;
		}
		.sugg__kind {
			grid-column: 1;
			grid-row: 1;
		}
		.sugg__label {
			grid-column: 1;
			grid-row: 2;
		}
		.sugg__hint {
			grid-column: 2;
			grid-row: 1 / span 2;
			align-self: center;
		}
	}
</style>
