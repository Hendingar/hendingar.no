<script lang="ts">
	import {
		VERIFICATION_CHECKS,
		VERIFICATION_CHECK_LABELS,
		VERIFICATION_CHECK_QUESTIONS,
		type VerificationCheck
	} from '@hendingar/core/verification';
	import type { CheckStats } from '../../collection.remote';

	/**
	 * What every check has decided, and what the two that call a model cost to ask.
	 *
	 * `/datasamling` could account for every imported event down to the endpoint it came from, and
	 * say nothing whatever about the half of the pipeline that judges. That is the wrong half to be
	 * quiet about. The README promises the agents' reasoning is auditable, and until now "auditable"
	 * meant one submission at a time: you could read why *your* event was declined and never find
	 * out whether the checks are any good.
	 *
	 * Both ADR 0017 and ADR 0018 name a falsification condition — "suggestions get accepted at a
	 * high rate and read the same as each other", "the picks read the same every week" — that needs
	 * numbers nobody was keeping. This is the shape of keeping them, and it is public rather than a
	 * dashboard, on the same argument as the rest of this page: a claim we publish is one we have to
	 * keep true.
	 *
	 * Rows come from the taxonomy, not from the query, so a check that has never run appears with
	 * zeroes rather than vanishing. A missing row on a page about completeness would be the one
	 * thing a reader could not tell from a check that always passes.
	 */
	let {
		checks,
		curator
	}: {
		checks: CheckStats[];
		curator: { nights: number; picks: number; latest: string | null };
	} = $props();

	type Row = {
		check: VerificationCheck;
		label: string;
		question: string;
		stats: CheckStats | undefined;
	};

	const rows: Row[] = $derived(
		VERIFICATION_CHECKS.map((check) => ({
			check,
			label: VERIFICATION_CHECK_LABELS[check],
			question: VERIFICATION_CHECK_QUESTIONS[check],
			stats: checks.find((row) => row.check === check)
		}))
	);

	const decided = $derived(checks.reduce((n, row) => n + row.total, 0));

	/*
	 * A share, as a percentage, or nothing at all.
	 *
	 * Nothing rather than 0 % when there is no denominator: "0 %" is a measurement and an empty
	 * table is not one, and this page's whole manner is to say what it actually knows.
	 */
	function share(part: number, whole: number): string | null {
		return whole > 0 ? `${Math.round((part / whole) * 100)} %` : null;
	}

	/** Milliseconds as the page says every other duration: seconds, one decimal. */
	function seconds(ms: number | null): string | null {
		return ms === null ? null : `${(ms / 1000).toFixed(1)} s`;
	}
</script>

<div class="ledger">
	{#if decided === 0}
		<!--
			Ordinary, not an error. A fresh database has had no submissions, and CI has no verifier
			at all — a table of six zeroes would say less than one sentence does.
		-->
		<p class="ledger__empty">
			Ingen innsendingar er kontrollerte enno, så det er ingenting å telje her.
		</p>
	{:else}
		<!--
			Wrapped, because six numeric columns do not fit 320px and must not push the page sideways
			(docs/brand.md). The wrapper scrolls; the page does not.
		-->
		<div class="ledger__scroll">
			<table class="ledger__table">
				<caption class="visually-hidden">
					Kva kvar kontroll har avgjort, og kva dei to som spør ein modell har kosta
				</caption>
				<thead>
					<tr>
						<th scope="col">Kontroll</th>
						<th scope="col" class="num">Avgjerder</th>
						<th scope="col" class="num">Gjekk gjennom</th>
						<th scope="col" class="num">Stoppa</th>
						<th scope="col" class="num">Snittsikkerheit</th>
						<th scope="col" class="num">Tid per kall</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.check)}
						<tr>
							<th scope="row">
								<span class="ledger__name">{row.label}</span>
								<span class="ledger__q">{row.question}</span>
							</th>
							<td class="num">{row.stats?.total ?? 0}</td>
							<td class="num">
								{share(row.stats?.passed ?? 0, row.stats?.total ?? 0) ?? '—'}
							</td>
							<td class="num">
								{share(
									(row.stats?.failed ?? 0) + (row.stats?.uncertain ?? 0),
									row.stats?.total ?? 0
								) ?? '—'}
							</td>
							<td class="num">
								{row.stats?.meanConfidence !== null && row.stats?.meanConfidence !== undefined
									? `${row.stats.meanConfidence} %`
									: '—'}
							</td>
							<!--
							Blank for the four checks a rule decides, and that blank is the point: it is
							the page saying, per row, which questions cost a model call and which are
							arithmetic. The README's table claims that split; this is it measured.
						-->
							<td class="num">{seconds(row.stats?.meanDurationMs ?? null) ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<p class="ledger__note">
			Tomme felt i siste kolonne er kontrollar som blir avgjorde av ein regel — same kva, kvar gong,
			utan å spørje ein modell. Tid er snitt over dei kalla som faktisk blei gjorde: ei innsending
			som ein regel stoppar, kjem aldri så langt, og blir ikkje rekna med.
		</p>
	{/if}

	{#if curator.nights > 0}
		<p class="ledger__note">
			Kuratoren har stått bak <strong>{curator.picks}</strong>
			val over
			<strong>{curator.nights}</strong>
			{curator.nights === 1 ? 'kveld' : 'kveldar'}, sist
			<!--
				The date as it is stored: a day, not an instant.

				`formatEventTime` is for a `timestamptz`, which is a moment somewhere — this names a
				weekend, and resolving it against a zone to print it would invent a time it does not
				have. ISO is unambiguous and needs no locale, which is the other half of the reason
				(CLAUDE.md: `nn-NO` does not exist in browser ICU).
			-->
			<time datetime={curator.latest}>{curator.latest}</time>. Tre er taket og aldri eit mål — ein
			kveld utan noko å peike på er eit ærleg svar, og ingenting blir fylt opp for å nå tre.
		</p>
	{/if}
</div>

<style>
	.ledger {
		display: grid;
		gap: 1rem;
	}
	.ledger__empty,
	.ledger__note {
		margin: 0;
		font-size: 0.875rem;
		color: var(--peach-dim);
		max-inline-size: 70ch;
	}
	/*
	 * A table, because this is a table: six labelled rows against six measures.
	 *
	 * It scrolls rather than reflows on a narrow screen. Six numeric columns cannot become one
	 * without becoming six stacked lists, and a reader comparing "gjekk gjennom" across checks is
	 * doing the one thing that layout would take away.
	 */
	.ledger__scroll {
		overflow-x: auto;
	}
	.ledger__table {
		inline-size: 100%;
		min-inline-size: 34rem;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
		font-size: 0.9375rem;
	}
	.ledger__table th,
	.ledger__table td {
		text-align: start;
		padding: 0.6rem 0.75rem 0.6rem 0;
		border-block-end: var(--rule) solid var(--peach-line);
		vertical-align: baseline;
	}
	.ledger__table thead th {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--peach-dim);
		font-weight: 400;
	}
	.ledger__table .num {
		text-align: end;
		padding-inline-end: 0;
		white-space: nowrap;
	}
	.ledger__table tbody th {
		font-weight: 400;
		padding-inline-end: 1.5rem;
	}
	.ledger__name {
		display: block;
	}
	.ledger__q {
		display: block;
		font-size: 0.8125rem;
		color: var(--peach-dim);
		max-inline-size: 34ch;
	}
</style>
