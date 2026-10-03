<script lang="ts">
	import { eventPath } from '@hendingar/core/slug';
	import { clubsOf, type WeeklyActivityRow } from '../../weekly-view.ts';

	/**
	 * Every club, choir and group, one poster card each — the directory under the day lens.
	 *
	 * This replaces a column of twenty-two closed folds that all looked the same. A card says three
	 * things at a glance: who, how much ("47 aktivitetar"), and which days, as a strip of seven
	 * pips — the site's own segmented-pip vocabulary (docs/brand.md), so a parent can see that the
	 * swimming club is early mornings and the scouts are Mondays without opening anything.
	 *
	 * The biggest club gets the inverted, double-width card: one poster on the wall printed in
	 * the other ink. It is also the one most readers are looking for.
	 *
	 * Three activities show; the rest sit in a `<details>`, which opens without JavaScript and
	 * which Ctrl-F still searches.
	 */
	let { activities }: { activities: WeeklyActivityRow[] } = $props();

	const clubs = $derived(clubsOf(activities));
	const total = $derived(clubs.reduce((n, c) => n + c.activities.length, 0));

	const SHOWN = 3;
	const DAYS = ['Må', 'Ty', 'On', 'To', 'Fr', 'La', 'Su'];
	const NAMES = ['måndag', 'tysdag', 'onsdag', 'torsdag', 'fredag', 'laurdag', 'sundag'];

	function meetsText(meets: boolean[]): string {
		const days = NAMES.filter((_, i) => meets[i]);
		return days.length === 7
			? 'Møtest alle dagar i veka'
			: `Møtest ${days.length > 1 ? `${days.slice(0, -1).join(', ')} og ${days.at(-1)}` : days[0]}`;
	}
</script>

{#if clubs.length > 0}
	<section class="clubs" aria-labelledby="h-clubs">
		<div class="clubs__head">
			<h2 id="h-clubs" class="display clubs__h">Lag og grupper</h2>
			<p class="label">
				{clubs.length === 1 ? 'éin arrangør' : `${clubs.length} arrangørar`} ·
				{total === 1 ? 'éin aktivitet' : `${total} aktivitetar`}
			</p>
		</div>

		<ul class="clubs__grid">
			{#each clubs as club, i (club.name)}
				<li class="club" class:club--lead={i === 0 && clubs.length > 2}>
					<h3 class="display display--md club__name">{club.name ?? 'Andre arrangørar'}</h3>
					<p class="club__count">
						{club.activities.length === 1
							? 'éin aktivitet'
							: `${club.activities.length} aktivitetar`}
					</p>

					<div class="pips" role="img" aria-label={meetsText(club.meets)}>
						{#each DAYS as d, j (d)}
							<span class="pip">
								<span class="pip__bar" class:pip__bar--on={club.meets[j]}></span>
								<span class="pip__d" aria-hidden="true">{d}</span>
							</span>
						{/each}
					</div>

					<ul class="club__acts">
						{#each club.activities.slice(0, SHOWN) as a (a.id)}
							<li>
								<a class="club__a" href={eventPath(a.id, a.title)}>{a.title}</a>
								<span class="club__when"
									>{a.cadence ? `${a.cadence}: ` : ''}{a.lines.join(', ')}</span
								>
							</li>
						{/each}
					</ul>

					{#if club.activities.length > SHOWN}
						<details class="club__more">
							<summary class="club__sum">Sjå alle {club.activities.length}</summary>
							<ul class="club__acts">
								{#each club.activities.slice(SHOWN) as a (a.id)}
									<li>
										<a class="club__a" href={eventPath(a.id, a.title)}>{a.title}</a>
										<span class="club__when"
											>{a.cadence ? `${a.cadence}: ` : ''}{a.lines.join(', ')}</span
										>
									</li>
								{/each}
							</ul>
						</details>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.clubs {
		display: grid;
		gap: 1.5rem;
		container-type: inline-size;
	}
	.clubs__head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}
	.clubs__head .label {
		margin: 0;
	}
	.clubs__h {
		font-size: clamp(2rem, 8cqw, 4rem);
		line-height: 0.95;
	}

	.clubs__grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(16rem, 100%), 1fr));
		gap: 0.9rem;
		align-items: start;
	}
	.club {
		display: grid;
		gap: 0.75rem;
		min-inline-size: 0;
		padding: 1.25rem;
		background: var(--navy-900);
		border: var(--rule) solid var(--peach-line);
		color: var(--peach);
		/* Read by the pips and links below, so the inverted card flips them in one place. */
		--ink: var(--peach);
		--ink-hi: var(--peach-hi);
		--ink-dim: var(--peach-dim);
	}
	/* The other ink: navy-900 on peach, 8.29:1 (docs/brand.md). */
	.club--lead {
		background: var(--peach);
		border-color: var(--peach);
		color: var(--navy-900);
		--ink: var(--navy-900);
		--ink-hi: var(--navy-900);
		--ink-dim: var(--navy-dim);
	}
	@container (width >= 34rem) {
		.club--lead {
			grid-column: span 2;
		}
	}
	.club__name {
		font-size: 1.375rem;
		line-height: 1.05;
	}
	.club__count {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.pips {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 0.2rem;
	}
	.pip {
		display: grid;
		gap: 0.25rem;
	}
	.pip__bar {
		display: block;
		block-size: 0.6rem;
		border: var(--rule) solid var(--ink);
	}
	.pip__bar--on {
		background: var(--ink);
	}
	.pip__d {
		font-family: var(--font-mono);
		font-size: 0.625rem;
		text-align: center;
		letter-spacing: 0.06em;
	}

	.club__acts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}
	.club__acts li {
		display: grid;
		gap: 0.1rem;
		min-inline-size: 0;
	}
	.club__a {
		font-family: var(--font-display);
		font-weight: 700;
		color: var(--ink-hi);
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.club__a:hover {
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.club__a:focus-visible,
	.club__sum:focus-visible {
		outline: 2px solid var(--ink-hi);
		outline-offset: 2px;
	}
	.club__when {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--ink-dim);
	}
	.club__more {
		display: grid;
		gap: 0.6rem;
	}
	/* A wrapper class, never bare `summary` — the specificity trap CLAUDE.md records. */
	.club__sum {
		cursor: pointer;
		min-block-size: 2.75rem;
		display: flex;
		align-items: center;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}
	.club__more[open] > .club__sum {
		margin-block-end: 0.6rem;
	}
</style>
