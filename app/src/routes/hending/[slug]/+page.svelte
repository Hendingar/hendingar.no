<script lang="ts">
	import SourceIcon from '../../../lib/components/SourceIcon.svelte';
	import { error } from '@sveltejs/kit';
	import { page } from '$app/state';
	import { categoryLabel } from '@hendingar/core/taxonomy';
	import { formatEventTime, formatEventClock, machineDateTime } from '@hendingar/core/datetime';
	import { eventIdFromParam, eventPath } from '@hendingar/core/slug';
	import {
		VERIFICATION_CHECK_LABELS,
		VERIFICATION_VERDICT_LABELS
	} from '@hendingar/core/verification';
	import { getEvent } from '../../../lib/events.remote';

	const id = eventIdFromParam(page.params.slug ?? '');
	if (id === null) error(404, 'Fann ikkje hendinga');

	// Top-level await so the page is real HTML for crawlers and for readers without JavaScript.
	const event = await getEvent(id);

	const canonical = $derived(eventPath(event.id, event.title));
	const sameDay = $derived(
		event.endsAt
			? formatEventTime(event.startsAt, event.venueTimeZone, 'full').slice(0, 12) ===
					formatEventTime(event.endsAt, event.venueTimeZone, 'full').slice(0, 12)
			: true
	);

	/**
	 * schema.org/Event as JSON-LD.
	 *
	 * We are an index, not a destination: being legible to search engines and calendar tools is the
	 * job. `startDate` uses the stored offset rather than UTC so a consumer reads the same wall
	 * clock a visitor does.
	 */
	const jsonLd = $derived(
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'Event',
			name: event.title,
			startDate: machineDateTime(event.startsAt),
			...(event.endsAt ? { endDate: machineDateTime(event.endsAt) } : {}),
			...(event.description ? { description: event.description } : {}),
			...(event.posterUrl ? { image: event.posterUrl } : {}),
			...(event.venueName
				? {
						location: {
							'@type': 'Place',
							name: event.venueName,
							...(event.venueAddress || event.venueMunicipality
								? {
										address: {
											'@type': 'PostalAddress',
											...(event.venueAddress ? { streetAddress: event.venueAddress } : {}),
											...(event.venueMunicipality
												? { addressLocality: event.venueMunicipality }
												: {}),
											addressCountry: 'NO'
										}
									}
								: {}),
							...(event.venueLatitude !== null && event.venueLongitude !== null
								? {
										geo: {
											'@type': 'GeoCoordinates',
											latitude: event.venueLatitude,
											longitude: event.venueLongitude
										}
									}
								: {})
						}
					}
				: {}),
			...(event.organizerName
				? { organizer: { '@type': 'Organization', name: event.organizerName } }
				: {}),
			...(event.ctaUrl ? { url: event.ctaUrl } : event.sourceUrl ? { url: event.sourceUrl } : {})
		})
	);
</script>

<svelte:head>
	<title>{event.title} — hendingar.no</title>
	<meta
		name="description"
		content={event.description?.slice(0, 160) ??
			`${categoryLabel(event.category)} ${event.venueName ? `på ${event.venueName}` : ''}`.trim()}
	/>
	<link rel="canonical" href={new URL(canonical, page.url.origin).href} />
	<meta property="og:title" content={event.title} />
	<meta property="og:type" content="article" />
	{#if event.posterUrl}
		<meta property="og:image" content={event.posterUrl} />
	{/if}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON.stringify output, not user markup -->
	{@html `<script type="application/ld+json">${jsonLd}</${'script'}>`}
</svelte:head>

<article class="ev">
	<div class="shell">
		<p class="ev__back"><a href="/hendingar">← Alle hendingar</a></p>

		<div class="ev__head">
			<p class="label">
				{categoryLabel(event.category)}
				{#if event.venueMunicipality}· {event.venueMunicipality}{/if}
			</p>
			<h1 class="display ev__h">{event.title}</h1>
		</div>

		<div class="ev__grid">
			<div class="ev__main">
				{#if event.posterUrl}
					<!-- Hotlinked, never re-hosted: the poster's rights are the source's, not ours. -->
					<img
						class="ev__poster"
						src={event.posterUrl}
						alt={`Plakat for ${event.title}`}
						loading="eager"
						decoding="async"
						referrerpolicy="no-referrer"
					/>
				{/if}

				{#if event.description}
					<div class="ev__desc">
						{#each event.description.split(/\n{2,}/) as paragraph (paragraph)}
							<p>{paragraph}</p>
						{/each}
					</div>
				{/if}

				{#if event.checks.length > 0}
					<!-- The README promises the verification reasoning is auditable rather than a black
					     box. The event's own page is the only place a reader would look for it. -->
					<details class="checks">
						<summary>Slik vart denne kontrollert</summary>
						<ol>
							{#each event.checks as check (check.check)}
								<li>
									<span class="checks__name">{VERIFICATION_CHECK_LABELS[check.check]}</span>
									<span class="checks__verdict">
										{VERIFICATION_VERDICT_LABELS[check.verdict]}
									</span>
									<span class="checks__why">{check.reasoning}</span>
									<span class="checks__by">
										{check.deterministic ? 'Regel' : (check.model ?? 'Modell')}
									</span>
								</li>
							{/each}
						</ol>
					</details>
				{/if}
			</div>

			<aside class="ev__side" aria-label="Praktisk">
				<dl class="facts">
					<div>
						<dt>Når</dt>
						<dd>
							<time datetime={machineDateTime(event.startsAt)}>
								{formatEventTime(event.startsAt, event.venueTimeZone, 'full')}
							</time>
							{#if event.endsAt}
								<span class="facts__to">
									–
									{#if sameDay}
										<time datetime={machineDateTime(event.endsAt)}>
											{formatEventClock(event.endsAt, event.venueTimeZone)}
										</time>
									{:else}
										<time datetime={machineDateTime(event.endsAt)}>
											{formatEventTime(event.endsAt, event.venueTimeZone, 'full')}
										</time>
									{/if}
								</span>
							{/if}
						</dd>
					</div>

					{#if event.venueName}
						<div>
							<dt>Stad</dt>
							<dd>
								{event.venueName}
								{#if event.venueAddress}<br /><span class="muted">{event.venueAddress}</span>{/if}
							</dd>
						</div>
					{/if}

					{#if event.organizerName}
						<div>
							<dt>Arrangør</dt>
							<dd>{event.organizerName}</dd>
						</div>
					{/if}
				</dl>

				{#if event.ctaUrl}
					<!-- Outbound. We never sell tickets — see the README non-goals. -->
					<a class="btn btn--solid" href={event.ctaUrl} rel="noopener nofollow">Billettar</a>
				{/if}

				{#if event.reportedBy.length > 0}
					<!--
						Every source that reported this event, not only the row that happened to win.

						Several calendars carry the same concert, and the canonical row is chosen by
						lowest id — an arbitrary tiebreak. Crediting just that one would name whichever
						importer ran first and silently drop the rest. Being an index, "three places
						say this is on" is the useful part.
					-->
					<div class="ev__sources">
						<p class="label">{event.reportedBy.length > 1 ? 'Kjelder' : 'Kjelde'}</p>
						<ul class="sources">
							{#each event.reportedBy as src (src.slug)}
								<li>
									<SourceIcon src={src.iconUrl} name={src.name} size="1rem" />
									{#if src.eventUrl}
										<a href={src.eventUrl} rel="noopener">{src.attribution}</a>
									{:else}
										<a href={src.siteUrl} rel="noopener">{src.attribution}</a>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{:else}
					<p class="ev__source">
						<span class="muted">
							Sendt inn av ein person{event.submissionMethod === 'photo' ? ' frå eit bilete' : ''}.
						</span>
					</p>
				{/if}
			</aside>
		</div>
	</div>
</article>

<style>
	.ev__sources {
		margin-block-start: 1.1rem;
	}
	.sources {
		list-style: none;
		margin: 0.35rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
	}
	.sources li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.ev {
		padding-block: clamp(1.5rem, 4vw, 3rem) var(--section-y);
		container-type: inline-size;
	}
	.ev__back {
		margin: 0 0 1.5rem;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}
	.ev__h {
		/* cqw, never vw: a long title has to shrink against its own column (docs/brand.md). */
		font-size: clamp(1.75rem, 8cqw, 4rem);
		margin-block: 0.2em 0;
		text-wrap: balance;
	}
	.ev__grid {
		margin-block-start: clamp(1.5rem, 4vw, 2.5rem);
		display: grid;
		gap: clamp(1.5rem, 4vw, 3rem);
		align-items: start;
	}
	@container (width >= 52rem) {
		.ev__grid {
			grid-template-columns: minmax(0, 1.6fr) minmax(15rem, 1fr);
		}
	}
	.ev__main {
		display: grid;
		gap: clamp(1rem, 3vw, 1.75rem);
		min-inline-size: 0;
	}
	.ev__poster {
		inline-size: 100%;
		block-size: auto;
		max-block-size: 34rem;
		object-fit: contain;
		background: var(--navy-900);
		border: var(--rule) solid var(--peach-line);
	}
	.ev__desc {
		display: grid;
		gap: 0.9em;
		max-inline-size: 68ch;
	}
	.ev__desc :global(p) {
		margin: 0;
	}
	.ev__side {
		display: grid;
		gap: 1.25rem;
		justify-items: start;
		padding: clamp(1rem, 3vw, 1.5rem);
		border: var(--rule) solid var(--peach-line);
		background: var(--navy-900);
	}
	.facts {
		margin: 0;
		display: grid;
		gap: 0.9rem;
	}
	.facts div {
		display: grid;
		gap: 0.2rem;
	}
	dt {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	dd {
		margin: 0;
	}
	.muted {
		color: var(--peach-dim);
	}
	.ev__source {
		margin: 0;
		font-size: 0.8125rem;
		display: grid;
		gap: 0.3rem;
	}

	.checks {
		border-block-start: var(--rule) solid var(--peach-line);
		padding-block-start: 1rem;
	}
	.checks summary {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		cursor: pointer;
		color: var(--peach-dim);
	}
	.checks ol {
		list-style: none;
		margin: 1rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.9rem;
	}
	.checks li {
		display: grid;
		gap: 0.15rem;
	}
	.checks__name {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.checks__verdict,
	.checks__by {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--peach-dim);
	}
	.checks__why {
		font-size: 0.9375rem;
	}
</style>
