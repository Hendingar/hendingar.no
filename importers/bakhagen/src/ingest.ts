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
	parseDetail,
	parseListing,
	readDetail,
	readListing,
	wait,
	type Pace,
	type ReadDetail,
	type ReadListing,
	type Wait
} from './api.ts';
import { INSTANCES, type BakhagenInstance } from './instances.ts';
import { isFailure, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per hagelag per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale. Two
 * hagelag therefore produce two rows and two lines on the page, not one combined run.
 */

export type IngestOptions = RunOptions & {
	readListing?: ReadListing;
	readDetail?: ReadDetail;
	/** Injected so tests wait for nothing — see `Wait` in api.ts. */
	wait?: Wait;
	pace?: Pace;
};

function upsertSource(db: Db, instance: BakhagenInstance) {
	return registerSource(db, {
		slug: instance.slug,
		name: instance.name,
		url: instance.url,
		endpoint: instance.url,
		note: 'Aktivitetssida til hagelaget er vanleg HTML med schema.org-mikrodata i kvart kort. Vi les korta direkte og hentar omtalen frå sida til kvar aktivitet, med fem sekund mellom kvart kall slik robots.txt ber om.',
		kind: 'html',
		scheduleCron: instance.scheduleCron,
		iconUrl: instance.iconUrl,
		trusted: instance.trusted,
		region: instance.region,
		attribution: instance.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent, instance: BakhagenInstance) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			municipality: null,
			timezone: instance.timezone,
			// Bakhagen renders an empty PostalAddress span and no coordinates anywhere. Flagged
			// rather than dropped, so an unplaceable venue is visible to the geocoder.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestInstance(
	connectionString: string,
	instance: BakhagenInstance,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const {
		readListing: listing = readListing,
		readDetail: detail = readDetail,
		wait: waitFor = wait,
		pace = createPacer(waitFor)
	} = options;

	const db = createDb(connectionString);
	const source = await upsertSource(db, instance);

	const report = await recordRun(db, source.id, options, async (run) => {
		await pace();
		const parsed = parseListing(await listing(instance), instance.url);

		/*
		 * Fail loudly when the page stops being the page.
		 *
		 * Zero activities is a legitimate answer here — a hagelag between programmes has nothing
		 * on, and the template then omits the activity list entirely rather than rendering an
		 * empty one. So "no events" cannot be an error, and without the check below a redesign, a
		 * moved URL or a login wall would all import nothing and report success. `recognised` is
		 * the page vouching for itself; see ParsedListing.
		 */
		if (!parsed.recognised) {
			throw new Error(
				`${instance.url} is no longer a Bakhagen activity page — the intro Article microdata naming this URL is gone`
			);
		}

		for (const problem of parsed.rejected) run.reject(problem);

		const seen = new Set<string>();

		for (const raw of parsed.events) {
			run.counts.fetched += 1;

			/*
			 * The description lives only on the activity's own page. A failure there is not a
			 * failure of the activity — we still have its title, time and place from the card — so
			 * it degrades to an event without a description rather than losing the row.
			 */
			let detailData = null;
			try {
				await pace();
				detailData = parseDetail(await detail(raw.sourceUrl));
			} catch (error) {
				run.note(
					`detail for ${raw.sourceUrl} failed: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}

			const mapped = mapEvent(raw, detailData, instance);
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

		/*
		 * An empty programme is recorded in words, because the counts alone cannot tell it apart
		 * from a run that read a page and understood nothing. `recognised` has already proved the
		 * page is ours, so this is a fact about the hagelag rather than a warning about the code.
		 * Ahead of the problems and outside their cap, as it always was.
		 */
		if (run.counts.fetched === 0) run.problems.unshift('the page lists no upcoming activities');
	});

	return { slug: instance.slug, ...report };
}

/**
 * Every configured hagelag. One failing site must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 *
 * The pacer is created once and shared, so the crawl delay is honoured across the whole run and
 * not restarted for each hagelag.
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
