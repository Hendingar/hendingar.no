<script lang="ts">
	import { SUBMISSION_TTL_HOURS } from '@hendingar/core/submissions';
	import { ensureClientId } from '../client-id.ts';

	/**
	 * Argue your case, and watch the panel decide.
	 *
	 * The automatic checks answer "does this parse". Whether somebody is telling the truth about a
	 * real event in their town is a judgement, and until now a wrong "nei" had no reply — the ADR
	 * that removed the review queue named that as its sharpest edge. This is the reply.
	 *
	 * Three jurors with different jobs, asked at once, each shown the moment it lands. Streamed
	 * because the alternative is a spinner for the length of the slowest one and then everything at
	 * once, which is precisely the experience this is meant to replace.
	 */
	let { eventId, rejectionReason = null }: { eventId: number; rejectionReason?: string | null } =
		$props();

	type Verdict = {
		juror: string;
		name: string;
		publish: boolean;
		confidence: number;
		reasoning: string;
		model: string | null;
	};

	const MIN = 10;
	const MAX = 2000;

	let text = $state('');
	let open = $state(false);
	let running = $state(false);
	let seats = $state<{ id: string; name: string }[]>([]);
	let verdicts = $state<Verdict[]>([]);
	let decision = $state<{ passed: boolean; forPublishing: number; of: number } | null>(null);
	let failure = $state('');

	const tooShort = $derived(text.trim().length < MIN);

	/** Seats not yet heard from, so the panel reads as three chairs rather than a growing list. */
	const pending = $derived(seats.filter((s) => !verdicts.some((v) => v.juror === s.id)));

	async function send() {
		if (tooShort || running) return;
		running = true;
		failure = '';
		verdicts = [];
		decision = null;

		try {
			const response = await fetch(`/ko/${eventId}/appell`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ clientId: ensureClientId(), appeal: text.trim() })
			});
			if (!response.ok || !response.body) {
				failure = (await response.text().catch(() => '')) || 'Klarte ikkje sende appellen.';
				return;
			}

			/*
			 * Parsed by hand rather than with EventSource, which only speaks GET — and this has to
			 * be a POST carrying the case and the browser id. Events are separated by a blank line,
			 * so anything after the last one is an incomplete frame and stays in the buffer.
			 */
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				let split = buffer.indexOf('\n\n');
				while (split !== -1) {
					const frame = buffer.slice(0, split);
					buffer = buffer.slice(split + 2);
					handle(frame);
					split = buffer.indexOf('\n\n');
				}
			}
		} catch {
			failure = 'Mista sambandet med panelet. Prøv igjen.';
		} finally {
			running = false;
		}
	}

	function handle(frame: string) {
		const name = /^event: (.+)$/m.exec(frame)?.[1];
		const raw = /^data: (.+)$/m.exec(frame)?.[1];
		if (!name || !raw) return;
		const data = JSON.parse(raw);
		if (name === 'panel') seats = data.jurors;
		else if (name === 'verdict') verdicts = [...verdicts, data];
		else if (name === 'decision') decision = data;
	}
</script>

<div class="appeal">
	{#if !open}
		<button type="button" class="appeal__open" onclick={() => (open = true)}>
			Ueinig? Legg fram saka di →
		</button>
	{:else}
		<div class="appeal__box">
			<p class="label">Appell</p>
			<p class="appeal__lede">
				Skriv med dine eigne ord kvifor denne bør ut. Tre jurorar les saka og avgjer — to av tre må
				seie ja. Du har éin sjanse per innsending, så ta med det som gjer hendinga truverdig: kven
				arrangerer, kvar såg du henne, kva veit du om ho.
			</p>
			{#if rejectionReason}
				<p class="appeal__against"><strong>Dette sa kontrollen:</strong> {rejectionReason}</p>
			{/if}

			<label class="appeal__label" for="appeal-{eventId}">Saka di</label>
			<textarea
				id="appeal-{eventId}"
				class="appeal__text"
				bind:value={text}
				rows="5"
				maxlength={MAX}
				disabled={running || decision !== null}
				placeholder="Til dømes: Eg tok bilete av plakaten på butikken på Vinsen. Det er båtforeininga som arrangerer, dei har gjort det kvart år sidan 2019."
			></textarea>
			<p class="appeal__count">{text.trim().length} / {MAX}</p>

			{#if decision === null}
				<button type="button" class="btn btn--solid" onclick={send} disabled={tooShort || running}>
					{running ? 'Panelet les …' : 'Legg fram saka'}
				</button>
			{/if}

			{#if failure}
				<p class="appeal__failure" role="alert">{failure}</p>
			{/if}

			{#if seats.length > 0}
				<ul class="jury" aria-live="polite">
					{#each verdicts as verdict (verdict.juror)}
						<li class="juror" data-publish={verdict.publish}>
							<div class="juror__top">
								<span class="juror__name">{verdict.name}</span>
								<span class="juror__vote">{verdict.publish ? 'Ja' : 'Nei'}</span>
							</div>
							<p class="juror__why">{verdict.reasoning}</p>
							{#if verdict.confidence > 0}
								<p class="juror__meta">
									{verdict.model ?? 'modell'} · {verdict.confidence} % visse
								</p>
							{/if}
						</li>
					{/each}
					<!-- The seats still out, so three chairs are visible from the start and the panel
					     does not look like a list that happens to have stopped growing. -->
					{#each pending as seat (seat.id)}
						<li class="juror juror--waiting">
							<div class="juror__top">
								<span class="juror__name">{seat.name}</span>
								<span class="juror__vote">les …</span>
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if decision}
				<p class="verdict-line" data-passed={decision.passed}>
					{#if decision.passed}
						{decision.forPublishing} av {decision.of} sa ja. Hendinga ligg ute no.
					{:else}
						{decision.forPublishing} av {decision.of} sa ja, og det er ikkje nok. Innsendinga blir sletta
						om {SUBMISSION_TTL_HOURS} timar.
					{/if}
				</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.appeal {
		inline-size: 100%;
	}
	.appeal__open {
		background: none;
		border: 0;
		padding: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
		text-decoration: underline;
		text-underline-offset: 0.25em;
		cursor: pointer;
	}
	.appeal__open:hover {
		color: var(--peach-hi);
	}
	.appeal__box {
		display: grid;
		gap: 0.55rem;
		justify-items: start;
		padding-inline-start: 1rem;
		border-inline-start: var(--rule-fat) solid var(--peach);
	}
	.appeal__lede,
	.appeal__against {
		margin: 0;
		font-size: 0.9375rem;
		max-inline-size: 64ch;
	}
	.appeal__against {
		color: var(--peach-dim);
	}
	.appeal__label {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	/* Selected on a wrapper class, never on the bare element: a component that styles `textarea`
	   silently restyles every textarea inside it. See CLAUDE.md. */
	.appeal__box .appeal__text {
		inline-size: min(100%, 60ch);
		font-family: var(--font-mono);
		font-size: 0.9375rem;
		padding: 0.6rem 0.7rem;
		color: var(--peach);
		background: var(--navy-800);
		border: var(--rule) solid var(--peach-line);
		resize: vertical;
	}
	.appeal__count {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-quiet);
	}
	.appeal__failure {
		margin: 0;
		font-size: 0.9375rem;
	}
	.jury {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
		inline-size: 100%;
	}
	.juror {
		display: grid;
		gap: 0.2rem;
		padding: 0.6rem 0.75rem;
		border: var(--rule) solid var(--peach-line);
		/* Each verdict arrives on its own, so it arrives visibly. */
		animation: rise var(--dur-base) var(--ease-out) both;
	}
	.juror--waiting {
		opacity: 0.55;
	}
	.juror__top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.juror__name {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		text-transform: uppercase;
		font-size: 0.95rem;
	}
	.juror__vote {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}
	.juror[data-publish='true'] .juror__vote {
		background: var(--peach);
		color: var(--navy-900);
		padding: 0.15em 0.5em;
	}
	.juror__why {
		margin: 0;
		font-size: 0.9375rem;
	}
	.juror__meta {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}
	.verdict-line {
		margin: 0.4rem 0 0;
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		text-transform: uppercase;
		font-size: 1.05rem;
	}
</style>
