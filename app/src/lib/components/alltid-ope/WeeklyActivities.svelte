<script lang="ts">
	import { eventPath } from '@hendingar/core/slug';
	import { describeWeeklyHours } from '@hendingar/core/weekly-hours';
	import type { WeeklyActivityGroup } from '../../events.remote';

	/**
	 * The clubs, choirs and groups that meet every week — one fold per organiser.
	 *
	 * These are a directory, not a list of places: "Bremnes G12, tysdag og onsdag 18:00" is
	 * something you join for a season. A hundred of them from one portal, mostly one per age group
	 * per club, so a flat grid would bury the museums above it under football squads — the outcome
	 * ADR 0013 measured and refused. Grouped by who runs them, it is twenty-odd names a parent can
	 * scan for the club they already know.
	 *
	 * Rows, not cards. Every one of these would have shown the same generated tile, and the thing a
	 * reader needs from a row is the timetable — which a card has no room for.
	 *
	 * `<details>` for the reasons `PlatformGroup` gives: it opens without JavaScript, is announced as
	 * expandable for free, and Ctrl-F still finds "G12" inside a closed one.
	 */
	let { groups }: { groups: WeeklyActivityGroup[] } = $props();

	const total = $derived(groups.reduce((n, g) => n + g.activities.length, 0));
</script>

{#if groups.length > 0}
	<section class="weekly" aria-labelledby="h-weekly">
		<p class="label">Kvar veke</p>
		<h2 id="h-weekly" class="display weekly__h">Faste aktivitetar</h2>
		<p class="weekly__lede">
			Lag, kor og grupper som møtest fast — trening, øving, treff. Samla etter kven som driv dei,
			med dagane og tidene kjelda oppgjev.
		</p>
		<p class="weekly__count">
			{total === 1 ? 'Éin aktivitet' : `${total} aktivitetar`} ·
			{groups.length === 1 ? 'éin arrangør' : `${groups.length} arrangørar`}
		</p>

		<div class="weekly__groups">
			{#each groups as group (group.organizer)}
				<!--
					Open by default when it holds a single activity: a fold hiding one row costs a click
					to learn nothing. The same rule PlatformGroup applies.
				-->
				<details class="org" open={group.activities.length === 1}>
					<summary class="org__sum">
						<span class="org__name">{group.organizer ?? 'Andre arrangørar'}</span>
						<span class="org__meta">
							{group.activities.length === 1
								? 'éin aktivitet'
								: `${group.activities.length} aktivitetar`}
						</span>
					</summary>

					<ul class="org__rows">
						{#each group.activities as activity (activity.id)}
							{@const when = activity.weeklyHours
								? describeWeeklyHours(activity.weeklyHours)
								: null}
							<li class="act">
								<a class="act__t" href={eventPath(activity.id, activity.title)}>{activity.title}</a>
								{#if when}
									<p class="act__when">
										{#if when.cadence}
											<span class="act__cad">{when.cadence}</span>
										{/if}
										{#each when.lines as line, i (i)}
											<span class="act__line">{line}</span>
										{/each}
									</p>
								{/if}
								{#if activity.venueName}
									<p class="act__where">
										<span class="visually-hidden">Stad: </span>{activity.venueName}
									</p>
								{/if}
							</li>
						{/each}
					</ul>
				</details>
			{/each}
		</div>
	</section>
{/if}

<style>
	.weekly {
		margin-block-start: clamp(3rem, 7vw, 5rem);
		container-type: inline-size;
	}
	.weekly__h {
		/* cqw, never vw — docs/brand.md. Smaller than the page's h1, because it sits under it. */
		font-size: clamp(1.5rem, 8cqw, 3.5rem);
		margin-block: 0.4rem 0.5rem;
	}
	.weekly__lede {
		max-inline-size: 56ch;
		color: var(--peach-dim);
		margin: 0 0 1.5rem;
	}
	.weekly__count {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--peach-dim);
		margin-block-end: 0.75rem;
	}
	.weekly__groups {
		border-block-start: var(--rule) solid var(--peach-line);
	}

	.org {
		border-block-end: var(--rule) solid var(--peach-line);
	}
	/* A wrapper class, never bare `summary` — the specificity trap CLAUDE.md records. */
	.org__sum {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		align-items: baseline;
		justify-content: space-between;
		padding: 0.9rem 0;
		cursor: pointer;
		list-style: none;
	}
	.org__sum::-webkit-details-marker {
		display: none;
	}
	/* On the name, so the marker stays beside the word it discloses — see PlatformGroup. */
	.org__name::before {
		content: '▸';
		margin-inline-end: 0.6rem;
		color: var(--peach-dim);
	}
	.org:open > .org__sum .org__name::before {
		content: '▾';
	}
	.org__sum:focus-visible {
		outline: 2px solid var(--peach-hi);
		outline-offset: 2px;
	}
	.org__name {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: var(--step-mid);
		letter-spacing: 0.01em;
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}
	.org__meta {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}

	.org__rows {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0 0 0 clamp(0.6rem, 2vw, 1.25rem);
		/* A rule on the inline start reads as "these belong to the name above". */
		border-inline-start: var(--rule-fat) solid var(--peach-line);
		display: grid;
		gap: 0.9rem;
	}
	.act {
		display: grid;
		gap: 0.2rem;
		min-inline-size: 0;
	}
	.act__t {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.0625rem;
		color: var(--peach-hi);
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.act__t:hover,
	.act__t:focus-visible {
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.act__when {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.15rem 0.9rem;
		font-family: var(--font-mono);
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
	}
	/*
	 * Outlined, not filled. Filled peach is this site's mark for one fixed time; this qualifies a
	 * pattern — the same reasoning StandingCard gives for its category chip.
	 */
	.act__cad {
		font-size: var(--step-micro);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		border: var(--rule) solid var(--peach-line);
		padding: 0.05rem 0.4rem;
	}
	.act__where {
		margin: 0;
		font-size: 0.875rem;
		color: var(--peach-dim);
	}
</style>
