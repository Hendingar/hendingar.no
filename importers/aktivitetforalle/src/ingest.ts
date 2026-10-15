import { createDb, type Db } from '@hendingar/core/db';
import {
	ingestEach,
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { organizers, venues } from '@hendingar/core/schema';
import { markGoneUpstream } from '@hendingar/core/gone-upstream';
import {
	orNull,
	parseEvents,
	parseFilters,
	parseLocations,
	parseOrganizers,
	read,
	type Read
} from './api.ts';
import { SITES, listingUrl, eventsUrl, type AfaSite } from './sites.ts';
import {
	isFailure,
	isPublishableActivity,
	isPublishableEvent,
	mapEvent,
	type MappedEvent
} from './map.ts';
import { slugifyVenue } from '@hendingar/core/slug';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per site per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
 */

export type IngestOptions = RunOptions & { fetcher?: Read };

function upsertSource(db: Db, site: AfaSite) {
	return registerSource(db, {
		slug: site.slug,
		name: site.name,
		url: listingUrl(site),
		endpoint: eventsUrl(site),
		kind: 'json-api',
		/*
		 * Written on every run, not left to whatever was there before.
		 *
		 * This source was registered as a `link` first, with a note saying we could not collect
		 * from it until events could be told from standing activities. That note survived the
		 * graduation — `upsertSource` did not touch the column — so /datasamling went on telling
		 * readers we collected nothing here while 121 events were being imported. A source's note
		 * describes how we collect it, so the importer is what owns it.
		 */
		note:
			'Portalen listar både enkelthendingar og faste, vekevise tilbod. Enkelthendingane står i ' +
			'kalenderen; dei faste tilboda står under «Alltid ope», samla etter kven som driv dei, ' +
			'med dagane og tidene kjelda oppgjev.',
		scheduleCron: site.scheduleCron,
		iconUrl: site.iconUrl,
		trusted: site.trusted,
		region: site.region,
		attribution: site.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent, site: AfaSite) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			/*
			 * Still null, and the address does not change that.
			 *
			 * `location_city` is a post town — "Bremnes", "Finnås" — and a post town is not a
			 * municipality: both of those are in Bømlo. It belongs to the postal address, which is
			 * where it now goes, and writing it here would be wrong in a way nothing downstream
			 * could detect. The same reasoning the TEC and allevents importers already record.
			 */
			municipality: null,
			address: mapped.venueAddress.street,
			postalCode: mapped.venueAddress.postalCode,
			timezone: site.timezone,
			// The portal carries a gps field and fills it on no event at all. Coordinates stay
			// unresolved; the address above is what the event pages actually need.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({
			target: venues.slug,
			set: {
				name: mapped.venueName,
				/*
				 * Only ever filled in, never blanked.
				 *
				 * A later run where the portal happens to omit the address must not erase one we
				 * already have — an event page that loses its address silently loses its rich
				 * result, and nothing would say why.
				 */
				...(mapped.venueAddress.street ? { address: mapped.venueAddress.street } : {}),
				...(mapped.venueAddress.postalCode ? { postalCode: mapped.venueAddress.postalCode } : {})
			}
		})
		.returning({ id: venues.id });
	return row?.id ?? null;
}

/**
 * The organiser's row, by the name the portal shows.
 *
 * Keyed on a slug of the name rather than the portal's id: `organizers` is shared by every source,
 * and the same choir reported by two calendars should be one organiser, not two.
 */
async function organizerIdFor(db: Db, name: string | null) {
	if (!name) return null;
	const slug = slugifyVenue(name);
	if (!slug) return null;
	const [row] = await db
		.insert(organizers)
		.values({ slug, name })
		.onConflictDoUpdate({ target: organizers.slug, set: { name } })
		.returning({ id: organizers.id });
	return row?.id ?? null;
}

export async function ingestSite(
	connectionString: string,
	site: AfaSite,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { fetcher = read } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, site);

	const report = await recordRun(db, source.id, options, async (run) => {
		let skipped = 0;

		const payload = await fetcher(site);
		const vocabulary = parseFilters(payload.filters);
		const locations = parseLocations(payload.locations);
		const organizerNames = parseOrganizers(payload.organizers);
		const parsed = parseEvents(payload.events);

		for (const problem of parsed.rejected) run.reject(`invalid event row: ${problem}`);

		const seen = new Set<string>();
		/*
		 * Every event the portal still lists, which is not the same set as the ones we import.
		 *
		 * `public` and nothing else: an archived or draft row is one the portal has taken down, and
		 * that is exactly what the sweep below is for. But a public row we decline to import — the
		 * one with no start time, the standing weekly activities — is still being published, so
		 * counting it present is what stops the sweep marking a live event gone on a technicality.
		 */
		const present = new Set<string>();

		for (const raw of parsed.rows) {
			if (orNull(raw.event_status) === 'public') present.add(String(raw.event_id));

			/*
			 * Archived and draft rows, activities with no timetable or no season, and the one
			 * public event that never got a start time.
			 *
			 * Counted separately from `rejected`: nothing changed shape, these are simply rows the
			 * portal holds that a what's-on listing should not repeat. `rejected` must go on
			 * meaning "the source moved".
			 */
			if (!isPublishableEvent(raw, site.timezone) && !isPublishableActivity(raw, site.timezone)) {
				skipped += 1;
				continue;
			}

			run.counts.fetched += 1;
			const mapped = mapEvent(raw, site, vocabulary, locations, organizerNames);
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

			const venueId = await venueIdFor(db, mapped, site);
			const organizerId = await organizerIdFor(db, mapped.organizerName);

			/*
			 * An untagged row maps to `anna`, and the portal leaves eBillett's mirrored films
			 * untagged. `upsertEvent` keeps a category consolidation has since filled in from
			 * another source rather than writing `anna` back over it. See `keepKnownCategory`.
			 */
			await run.upsertEvent({
				sourceId: source.id,
				externalId: mapped.externalId,
				sourceUrl: mapped.sourceUrl,
				title: mapped.title,
				description: mapped.description,
				category: mapped.category,
				startsAt: mapped.startsAt,
				endsAt: mapped.endsAt,
				venueId,
				organizerId,
				weeklyHours: mapped.weeklyHours,
				ageFrom: mapped.ageFrom,
				ageTo: mapped.ageTo,
				ctaUrl: mapped.ctaUrl,
				posterUrl: mapped.posterUrl,
				posterSrcset: mapped.posterSrcset,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? 'published' : 'pending'
			});
		}

		/*
		 * What the portal has stopped listing.
		 *
		 * Safe here because one request returns the whole collection — `listingIsComplete` says so
		 * beside the URL that makes it true. Nothing is deleted: the row keeps its page, its hearts
		 * and its views, and only drops out of the listings. See `markGoneUpstream`.
		 */
		let swept = { marked: 0, restored: 0 };
		if (site.listingIsComplete && !run.dryRun) {
			swept = await markGoneUpstream(db, { sourceId: source.id, seen: present, now: run.now() });
		}

		/*
		 * The skipped count is recorded even on a clean run: it is the only place the rows we
		 * decline are visible, and the number that moves if the portal changes how it files things.
		 * Ahead of the problems and outside their cap, as they always were.
		 */
		const summary = [
			skipped > 0
				? `${skipped} rows skipped (archived, draft, undated, or an activity with no timetable or season)`
				: null,
			// Said out loud on the run, because a row leaving the site should never be something
			// only the database knows about.
			swept.marked > 0 ? `${swept.marked} no longer listed by the source` : null,
			swept.restored > 0 ? `${swept.restored} listed again` : null
		].filter((line) => line !== null);
		run.problems.unshift(...summary);
	});

	return { slug: site.slug, ...report };
}

/**
 * Every configured site. One failing portal must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	return ingestEach(SITES, (site) => ingestSite(connectionString, site, options));
}
