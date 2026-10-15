import { createDb, type Db } from '@hendingar/core/db';
import {
	ingestEach,
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { venues } from '@hendingar/core/schema';
import {
	createPacer,
	parseVenuePage,
	readVenuePage,
	wait,
	type Pace,
	type ReadVenuePage,
	type Wait
} from './api.ts';
import { INSTANCES, type RiksteatretInstance } from './instances.ts';
import { isFailure, mapPerformance, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per venue per execution, **including failures** — /datasamling renders
 * that table, and a source that stops reporting must become visible rather than quietly stale.
 * Two venues therefore produce two rows and two lines on the page, not one combined run.
 */

export type IngestOptions = RunOptions & {
	read?: ReadVenuePage;
	/** Injected so the tests are hermetic *and* fast — they wait for nothing (CLAUDE.md rule 6). */
	wait?: Wait;
	pace?: Pace;
};

function upsertSource(db: Db, instance: RiksteatretInstance) {
	return registerSource(db, {
		slug: instance.slug,
		name: instance.name,
		url: instance.url,
		endpoint: instance.url,
		kind: 'html',
		/*
		 * Replaces the note this row carried while it was a `link`, which said we planned to
		 * collect it one day. Graduating a source without rewriting that would leave /datasamling
		 * promising future coverage of a calendar it is, at that moment, showing fresh events from.
		 */
		note: 'Programmet for spelestaden på riksteatret.no. Sida er server-rendra HTML utan feed, så vi les kvar framsyning rett frå datetime-attributtet på programkortet.',
		scheduleCron: instance.scheduleCron,
		iconUrl: instance.iconUrl,
		trusted: instance.trusted,
		region: instance.region,
		attribution: instance.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent, instance: RiksteatretInstance) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			municipality: null,
			timezone: instance.timezone,
			// No coordinates on the venue page — the address is prose in an "Om <hall>" block.
			// Flagged rather than dropped, so an unplaceable venue is visible to the geocoder.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestInstance(
	connectionString: string,
	instance: RiksteatretInstance,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { read = readVenuePage, wait: waitFor = wait, pace = createPacer(waitFor) } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, instance);

	const report = await recordRun(db, source.id, options, async (run) => {
		await pace();
		const page = parseVenuePage(await read(instance), instance.url);

		/*
		 * An empty programme is legitimate — a touring theatre is not in every hall every month —
		 * so zero performances cannot fail a run. `recognised` is what separates that from the
		 * page having moved, which on this host means a 302 to a 200-OK 404 page. Without the
		 * check a redesign would import nothing and report success forever.
		 */
		if (!page.recognised) {
			throw new Error(
				`${instance.url} did not look like a Riksteatret venue page (no matching og:url)`
			);
		}

		for (const problem of page.rejected) run.reject(problem);

		// The same performance is never printed twice on a page, but a template change that
		// repeated one must not double the counts.
		const seen = new Set<string>();

		for (const raw of page.performances) {
			run.counts.fetched += 1;
			const mapped = mapPerformance(
				raw,
				page.postersByProduction.get(raw.productionId) ?? null,
				instance
			);
			if (isFailure(mapped)) {
				run.reject(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}
			if (seen.has(mapped.externalId)) continue;
			seen.add(mapped.externalId);

			if (run.dryRun) {
				run.counts.created += 1;
				continue;
			}

			await run.upsertEvent({
				sourceId: source.id,
				externalId: mapped.externalId,
				sourceUrl: mapped.sourceUrl,
				title: mapped.title,
				description: mapped.description,
				category: mapped.category,
				startsAt: mapped.startsAt,
				endsAt: mapped.endsAt,
				venueId: await venueIdFor(db, mapped, instance),
				ctaUrl: mapped.ctaUrl,
				posterUrl: mapped.posterUrl,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? 'published' : 'pending'
			});
		}
	});

	return { slug: instance.slug, ...report };
}

/**
 * Every configured venue. One failing page must not stop the others — they are independent sources
 * that happen to share a parser, so a failure is recorded against that source alone.
 *
 * The pacer is created once and shared, because the crawl delay is about the site, not about a
 * single venue: a run walking several halls is one crawler as far as riksteatret.no is concerned.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const pace = options.pace ?? createPacer(options.wait ?? wait);
	return ingestEach(INSTANCES, (instance) =>
		ingestInstance(connectionString, instance, { ...options, pace })
	);
}
