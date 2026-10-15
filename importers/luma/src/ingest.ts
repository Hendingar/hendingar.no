import { createDb, type Db } from '@hendingar/core/db';
import {
	ingestEach,
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { venues } from '@hendingar/core/schema';
import { parseItems, read, type Read, type UpstreamEntry } from './api.ts';
import { CALENDARS, itemsUrl, listingUrl, type LumaCalendar } from './calendars.ts';
import { isFailure, isPublishable, mapEntry, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path (ADR 0004).
 *
 * One `ingest_runs` row per calendar per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
 */

export type IngestOptions = RunOptions & { fetcher?: Read };

function upsertSource(db: Db, calendar: LumaCalendar) {
	return registerSource(db, {
		slug: calendar.slug,
		name: calendar.name,
		url: listingUrl(calendar),
		endpoint: itemsUrl(calendar, 'future'),
		kind: 'json-api',
		/*
		 * Written on every run rather than left to whatever was there before — the note describes
		 * how we collect a source, so the importer is what owns it. `aktivitetforalle` records what
		 * happens when it is not: a stale note told readers we collected nothing while 121 events
		 * were being imported.
		 */
		note:
			'Luma-kalenderen til arrangøren. Vi hentar det som ligg framover, og siste sida med ' +
			'det som alt har vore, så ei samling som er i gang ikkje forsvinn frå lista. ' +
			'Kalenderen oppgjev inga kategori, så hendingane kjem inn som «anna».',
		scheduleCron: calendar.scheduleCron,
		iconUrl: calendar.iconUrl,
		trusted: calendar.trusted,
		region: calendar.region,
		attribution: calendar.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	/*
	 * Coordinates come from the source, so the venue is `resolved` rather than `pending`.
	 *
	 * Not a geocoder — that was tried and rejected (see `packages/core/src/address.ts`: Kartverket
	 * matched five of sixteen Sunnhordland venues correctly and four *wrongly*). This is Luma
	 * repeating the coordinate Google gave the organiser when they picked their own venue out of an
	 * autocomplete, which is the source's own assertion about its own event — the same standing as
	 * the schema.org an importer reads off a page, and the only kind of coordinate worth storing.
	 */
	const located = mapped.latitude !== null && mapped.longitude !== null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			// A post town is not a municipality. See the note in map.ts.
			municipality: null,
			address: mapped.venueAddress.street,
			postalCode: mapped.venueAddress.postalCode,
			latitude: mapped.latitude,
			longitude: mapped.longitude,
			timezone: mapped.venueTimezone,
			geocodeStatus: located ? ('resolved' as const) : ('pending' as const)
		})
		.onConflictDoUpdate({
			target: venues.slug,
			set: {
				name: mapped.venueName,
				/*
				 * Only ever filled in, never blanked. A later run where the payload happens to omit
				 * the address must not erase one we already have: an event page that loses its
				 * address silently loses its rich result, and nothing would say why.
				 */
				...(mapped.venueAddress.street ? { address: mapped.venueAddress.street } : {}),
				...(mapped.venueAddress.postalCode ? { postalCode: mapped.venueAddress.postalCode } : {}),
				...(located
					? {
							latitude: mapped.latitude,
							longitude: mapped.longitude,
							geocodeStatus: 'resolved' as const
						}
					: {}),
				timezone: mapped.venueTimezone
			}
		})
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestCalendar(
	connectionString: string,
	calendar: LumaCalendar,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { fetcher = read } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, calendar);

	const report = await recordRun(db, source.id, options, async (run) => {
		let skipped = 0;

		const pages = await fetcher(calendar);
		const entries: UpstreamEntry[] = [];
		for (const page of pages) {
			const parsed = parseItems(page);
			entries.push(...parsed.rows);
			for (const problem of parsed.rejected) run.reject(`invalid entry: ${problem}`);
		}

		const seen = new Set<string>();

		for (const entry of entries) {
			if (!isPublishable(entry)) {
				skipped += 1;
				continue;
			}

			run.counts.fetched += 1;
			const mapped = mapEntry(entry, calendar);
			if (isFailure(mapped)) {
				run.reject(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}
			/*
			 * The future and past pages can name the same event, and a paginated future can repeat
			 * one across a cursor boundary. First write wins; the rest are not counted at all,
			 * because "unchanged" would imply we compared it against the database.
			 */
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
				venueId: await venueIdFor(db, mapped),
				ctaUrl: mapped.ctaUrl,
				posterUrl: mapped.posterUrl,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? 'published' : 'pending'
			});
		}

		// Ahead of the capped problems and outside the cap, as it always was.
		if (skipped > 0) {
			run.problems.unshift(`${skipped} entries skipped (not public, not approved, or online only)`);
		}
	});

	return { slug: calendar.slug, ...report };
}

/**
 * Every configured calendar. One failing calendar must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	return ingestEach(CALENDARS, (calendar) => ingestCalendar(connectionString, calendar, options));
}
