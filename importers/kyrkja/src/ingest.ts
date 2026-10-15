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
	INSTANCES,
	extractCalendarHtml,
	fetchCalendar,
	parseCalendar,
	type FetchCalendar,
	type KyrkjaInstance
} from './api.ts';
import { type MappedEvent, isFailure, isPrivateOccasion, mapEvent } from './map.ts';

/**
 * Deterministic: fetch → validate → map → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per venue per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
 */

export type IngestOptions = RunOptions & { read?: FetchCalendar };

function upsertSource(db: Db, instance: KyrkjaInstance) {
	return registerSource(db, {
		slug: instance.slug,
		name: instance.name,
		url: instance.url,
		endpoint: instance.url,
		/*
		 * Replaces the note this row carried while it was a `link`, which said we did NOT collect
		 * it. Graduating a source without clearing that would leave /datasamling explaining why we
		 * cannot fetch a calendar it is, at that moment, showing fresh events from.
		 */
		note: 'Kalenderen ligg JSON-koda inne i sida og blir sett inn av JavaScript. Vi pakkar ut den strengen og les han direkte — ingen nettlesar involvert.',
		kind: 'html',
		scheduleCron: instance.scheduleCron,
		iconUrl: instance.iconUrl,
		trusted: instance.trusted,
		region: instance.region,
		attribution: instance.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent, instance: KyrkjaInstance) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			municipality: null,
			timezone: instance.timezone,
			// No coordinates anywhere in MEC's output. Flagged rather than dropped, so an
			// unplaceable venue is visible to the geocoder instead of vanishing.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestInstance(
	connectionString: string,
	instance: KyrkjaInstance,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { read = fetchCalendar } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, instance);

	const report = await recordRun(db, source.id, options, async (run) => {
		// Private family occasions we deliberately do not republish — see isPrivateOccasion.
		let withheld = 0;

		/*
		 * Fail loudly if the blob or the rewrite instructions are gone.
		 *
		 * A redesign that stops embedding the calendar would otherwise parse to zero events and
		 * report success — the importer's own definition of "the source went quiet" has to be an
		 * error, not an empty list. A page that still embeds the calendar but no longer says where
		 * its detail pages live is the same kind of silence: the links in the blob are a template,
		 * and publishing them unrewritten means publishing 404s.
		 */
		const calendarHtml = extractCalendarHtml(await read(instance));
		if (!calendarHtml) {
			throw new Error(
				'no usable calendar in the page — the embedded JSON blob or the OutputCalendar call is gone'
			);
		}

		const parsed = parseCalendar(calendarHtml, instance.url);
		for (const problem of parsed.rejected) run.reject(problem);

		const seen = new Set<string>();

		for (const raw of parsed.events) {
			/*
			 * A funeral or a wedding is on the parish calendar because the church is booked, not
			 * because anyone should turn up. Skipped before it is counted as fetched: it is not a
			 * row we failed to read, it is a row we chose not to republish, and `rejected` must go
			 * on meaning "the source changed shape".
			 */
			if (isPrivateOccasion(raw.label)) {
				withheld += 1;
				continue;
			}

			run.counts.fetched += 1;
			const mapped = mapEvent(raw, instance);
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
		 * The withheld count is recorded even on a clean run, ahead of the capped problems and
		 * outside the cap.
		 *
		 * It is the only place the decision not to republish funerals and weddings is visible. A
		 * run that suddenly withholds nothing means the parish relabelled them, and that should be
		 * noticeable on /datasamling rather than a silent change in what we publish.
		 */
		if (withheld > 0) {
			run.problems.unshift(`${withheld} private occasions withheld (gravferd/vigsel)`);
		}
	});

	return { slug: instance.slug, ...report };
}

/**
 * Every configured instance. One failing site must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	return ingestEach(INSTANCES, (instance) => ingestInstance(connectionString, instance, options));
}
