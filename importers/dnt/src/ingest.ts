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
	fetchAllPages,
	parseDetails,
	readDetails,
	readListing,
	type ReadDetails,
	type ReadListing
} from './api.ts';
import { ASSOCIATIONS, calendarUrl, type DntAssociation } from './associations.ts';
import { isFailure, mapActivity, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per turlag per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale. Two
 * turlag therefore produce two rows and two lines on the page, not one combined run.
 */

export type IngestOptions = RunOptions & { listing?: ReadListing; details?: ReadDetails };

function upsertSource(db: Db, association: DntAssociation) {
	return registerSource(db, {
		slug: association.slug,
		name: association.name,
		url: calendarUrl(association),
		endpoint: `https://www.dnt.no/api/activities?associations=${association.associationId}`,
		note: 'Vi les `/api/activities`, det same kallet aktivitetskalenderen deira sjølv gjer, og hentar omtalen frå `/api/search/activitydetails` — turlaget si eiga side opnar berre eit vindauge og har ingen fungerande lenke per tur.',
		kind: 'json-api',
		scheduleCron: association.scheduleCron,
		iconUrl: association.iconUrl,
		trusted: association.trusted,
		region: association.region,
		attribution: association.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent, association: DntAssociation) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			municipality: null,
			timezone: association.timezone,
			// DNT publishes no coordinates for a meeting point. Flagged rather than dropped, so an
			// unplaceable venue is visible to the geocoder instead of vanishing.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestAssociation(
	connectionString: string,
	association: DntAssociation,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { listing = readListing, details = readDetails } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, association);

	const report = await recordRun(db, source.id, options, async (run) => {
		const parsed = await fetchAllPages(association, listing);
		for (const problem of parsed.rejected) run.reject(`invalid page hit: ${problem}`);

		/*
		 * A co-organised trip is listed by every turlag involved, so the two we import share two
		 * activities. Within one turlag's own pages an id should be unique, but the guard is cheap
		 * and keeps the run counts honest if DNT ever repeats one across pages.
		 */
		const seen = new Set<string>();

		for (const activity of parsed.activities) {
			run.counts.fetched += 1;

			/*
			 * The description and the sign-up link live behind a second call. A failure there is
			 * not a failure of the activity — we still know its title, time and meeting point — so
			 * it degrades to an event without a description rather than losing the row entirely.
			 */
			let detail = null;
			try {
				detail = parseDetails(await details(activity.id));
			} catch (error) {
				run.note(
					`details for ${activity.id} failed: ${error instanceof Error ? error.message : String(error)}`
				);
			}

			const mapped = mapActivity(activity, detail, association);
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
				venueId: await venueIdFor(db, mapped, association),
				ctaUrl: mapped.ctaUrl,
				posterUrl: mapped.posterUrl,
				posterRightsVerified: mapped.posterRightsVerified,
				trail: mapped.trail,
				/*
				 * A cancelled trip is stored, but never listed.
				 *
				 * DNT marks it "Avlyst" and keeps showing it, which is useful — somebody who heard
				 * about the trip wants to learn it is off. We have no way to render that yet, and
				 * a listing that shows a cancelled hike as if it were on sends someone to a car
				 * park on a Sunday morning. So the row is kept, with its provenance, at a status
				 * the listing queries filter out. Keeping rather than deleting it means the next
				 * run can put it back the moment DNT un-cancels, and that nothing silently
				 * disappears from a source we claim to be collecting.
				 */
				status: mapped.cancelled ? 'rejected' : source.trusted ? 'published' : 'pending'
			});
		}
	});

	return { slug: association.slug, ...report };
}

/**
 * Every configured turlag. One failing calendar must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	return ingestEach(ASSOCIATIONS, (association) =>
		ingestAssociation(connectionString, association, options)
	);
}
