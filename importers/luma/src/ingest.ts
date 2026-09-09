import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
import { parseItems, read, type Read, type UpstreamEntry } from './api.ts';
import { CALENDARS, itemsUrl, listingUrl, type LumaCalendar } from './calendars.ts';
import { isFailure, isPublishable, mapEntry, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path (ADR 0004).
 *
 * One `ingest_runs` row per calendar per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
 */

export type IngestResult = {
	runId: number;
	slug: string;
	status: 'success' | 'partial' | 'failed';
	fetched: number;
	created: number;
	updated: number;
	unchanged: number;
	rejected: number;
	durationMs: number;
	message: string | null;
};

export type IngestOptions = {
	fetcher?: Read;
	trigger?: string;
	revision?: string | null;
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db, calendar: LumaCalendar) {
	const shared = {
		name: calendar.name,
		url: listingUrl(calendar),
		endpoint: itemsUrl(calendar, 'future'),
		kind: 'json-api' as const,
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
		active: true,
		scheduleCron: calendar.scheduleCron,
		iconUrl: calendar.iconUrl,
		trusted: calendar.trusted
	};
	const [row] = await db
		.insert(sources)
		.values({
			slug: calendar.slug,
			region: calendar.region,
			attribution: calendar.attribution,
			...shared
		})
		.onConflictDoUpdate({ target: sources.slug, set: shared })
		.returning();
	if (!row) throw new Error(`could not register the source ${calendar.slug}`);
	return row;
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
	const {
		fetcher = read,
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db, calendar);

	// A dry run opens no run row: the row is inserted as `running` and only closed on the success
	// path, so opening one would leave /datasamling showing an import that never finished.
	let runId = -1;
	if (!dryRun) {
		const [run] = await db
			.insert(ingestRuns)
			.values({ sourceId: source.id, startedAt, status: 'running', trigger, revision })
			.returning({ id: ingestRuns.id });
		if (!run) throw new Error('could not open an ingest run');
		runId = run.id;
	}

	let fetched = 0;
	let created = 0;
	let updated = 0;
	let unchanged = 0;
	let rejected = 0;
	let skipped = 0;
	const problems: string[] = [];

	try {
		const pages = await fetcher(calendar);
		const entries: UpstreamEntry[] = [];
		for (const page of pages) {
			const parsed = parseItems(page);
			entries.push(...parsed.rows);
			for (const problem of parsed.rejected) {
				rejected += 1;
				if (problems.length < 10) problems.push(`invalid entry: ${problem}`);
			}
		}

		const seen = new Set<string>();

		for (const entry of entries) {
			if (!isPublishable(entry)) {
				skipped += 1;
				continue;
			}

			fetched += 1;
			const mapped = mapEntry(entry, calendar);
			if (isFailure(mapped)) {
				rejected += 1;
				if (problems.length < 10) {
					problems.push(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				}
				continue;
			}
			/*
			 * The future and past pages can name the same event, and a paginated future can repeat
			 * one across a cursor boundary. First write wins; the rest are not counted at all,
			 * because "unchanged" would imply we compared it against the database.
			 */
			if (seen.has(mapped.externalId)) continue;
			seen.add(mapped.externalId);

			if (dryRun) {
				created += 1;
				continue;
			}

			const venueId = await venueIdFor(db, mapped);

			const values = {
				sourceId: source.id,
				externalId: mapped.externalId,
				sourceUrl: mapped.sourceUrl,
				title: mapped.title,
				description: mapped.description,
				category: mapped.category,
				startsAt: mapped.startsAt,
				endsAt: mapped.endsAt,
				venueId,
				ctaUrl: mapped.ctaUrl,
				posterUrl: mapped.posterUrl,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? ('published' as const) : ('pending' as const)
			};

			// Read before write, so a run reports what actually changed rather than marking every
			// event "updated" daily and burying the one day a source really moved.
			const [existing] = await db
				.select({
					id: events.id,
					title: events.title,
					description: events.description,
					category: events.category,
					startsAt: events.startsAt,
					endsAt: events.endsAt,
					venueId: events.venueId,
					ctaUrl: events.ctaUrl,
					posterUrl: events.posterUrl,
					posterRightsVerified: events.posterRightsVerified,
					status: events.status,
					sourceUrl: events.sourceUrl
				})
				.from(events)
				.where(and(eq(events.sourceId, source.id), eq(events.externalId, mapped.externalId)))
				.limit(1);

			if (!existing) {
				await db.insert(events).values(values);
				created += 1;
				continue;
			}

			const same =
				existing.title === values.title &&
				existing.description === values.description &&
				existing.category === values.category &&
				+existing.startsAt === +values.startsAt &&
				(existing.endsAt?.getTime() ?? null) === (values.endsAt?.getTime() ?? null) &&
				existing.venueId === values.venueId &&
				existing.ctaUrl === values.ctaUrl &&
				existing.posterUrl === values.posterUrl &&
				existing.posterRightsVerified === values.posterRightsVerified &&
				existing.status === values.status &&
				existing.sourceUrl === values.sourceUrl;

			if (same) {
				unchanged += 1;
				continue;
			}

			await db
				.update(events)
				.set({ ...values, updatedAt: now() })
				.where(eq(events.id, existing.id));
			updated += 1;
		}

		const status: IngestResult['status'] = rejected > 0 ? 'partial' : 'success';
		const finishedAt = now();
		const durationMs = finishedAt.getTime() - startedAt.getTime();
		const notes = [
			skipped > 0 ? `${skipped} entries skipped (not public, not approved, or online only)` : null,
			...problems
		].filter(Boolean);
		const message = notes.length ? notes.join('; ').slice(0, 2000) : null;

		if (!dryRun) {
			await db
				.update(ingestRuns)
				.set({
					finishedAt,
					status,
					fetched,
					created,
					updated,
					unchanged,
					rejected,
					durationMs,
					message
				})
				.where(eq(ingestRuns.id, runId));
			await db.update(sources).set({ lastRunAt: finishedAt }).where(eq(sources.id, source.id));
		}

		return {
			runId,
			slug: calendar.slug,
			status,
			fetched,
			created,
			updated,
			unchanged,
			rejected,
			durationMs,
			message
		};
	} catch (error) {
		const finishedAt = now();
		const message = error instanceof Error ? error.message : String(error);
		// Nothing to close if the run was never opened.
		if (dryRun) throw error;
		await db
			.update(ingestRuns)
			.set({
				finishedAt,
				status: 'failed',
				fetched,
				created,
				updated,
				unchanged,
				rejected,
				durationMs: finishedAt.getTime() - startedAt.getTime(),
				message: message.slice(0, 2000)
			})
			.where(eq(ingestRuns.id, runId));
		throw error;
	}
}

/**
 * Every configured calendar. One failing calendar must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const results: IngestResult[] = [];
	for (const calendar of CALENDARS) {
		try {
			results.push(await ingestCalendar(connectionString, calendar, options));
		} catch (error) {
			results.push({
				runId: -1,
				slug: calendar.slug,
				status: 'failed',
				fetched: 0,
				created: 0,
				updated: 0,
				unchanged: 0,
				rejected: 0,
				durationMs: 0,
				message: error instanceof Error ? error.message : String(error)
			});
		}
	}
	return results;
}
