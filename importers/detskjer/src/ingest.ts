import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, organizers, sources, venues } from '@hendingar/core/schema';
import { SOURCE, collectPages, type FetchPage, fetchPage } from './api.ts';
import { isFailure, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → validate → map → upsert. No language model touches this path.
 *
 * Every execution writes an `ingest_runs` row, including failures. That row is what /datasamling
 * renders — without it the page could claim a source is collected but never show that it was.
 */

export type IngestResult = {
	runId: number;
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
	read?: FetchPage;
	trigger?: string;
	revision?: string | null;
	/** Map and count, write nothing. For inspecting a source change safely. */
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db) {
	const [row] = await db
		.insert(sources)
		.values({
			slug: SOURCE.slug,
			name: SOURCE.name,
			url: SOURCE.url,
			endpoint: SOURCE.endpoint,
			region: SOURCE.region,
			attribution: SOURCE.attribution,
			kind: 'json-api',
			scheduleCron: '0 5 * * *',
			iconUrl: SOURCE.iconUrl,
			// Editorially moderated upstream — see the column comment in schema.ts.
			trusted: true
		})
		.onConflictDoUpdate({
			target: sources.slug,
			set: {
				name: SOURCE.name,
				url: SOURCE.url,
				endpoint: SOURCE.endpoint,
				kind: 'json-api',
				scheduleCron: '0 5 * * *',
				// In the update as well as the insert. A field written only on insert can never be
				// corrected on a row that already exists — the same trap that left
				// `posterRightsVerified` stuck until the change-detection fix.
				iconUrl: SOURCE.iconUrl,
				trusted: true
			}
		})
		.returning();
	if (!row) throw new Error('could not register the source');
	return row;
}

async function venueIdFor(db: Db, mapped: MappedEvent): Promise<number | null> {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			municipality: null,
			// The source gives a free-text venue name and no coordinates. Geocoding is a separate
			// concern; flagging it here is what stops an unplaceable venue from silently vanishing.
			timezone: SOURCE.timezone,
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

async function organizerIdFor(db: Db, mapped: MappedEvent): Promise<number | null> {
	if (!mapped.organizerName || !mapped.organizerSlug) return null;
	const [row] = await db
		.insert(organizers)
		.values({ name: mapped.organizerName, slug: mapped.organizerSlug })
		.onConflictDoUpdate({ target: organizers.slug, set: { name: mapped.organizerName } })
		.returning({ id: organizers.id });
	return row?.id ?? null;
}

export async function ingest(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const {
		read = fetchPage,
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db);

	/*
	 * A dry run opens no run row.
	 *
	 * The row is inserted as `running` and only closed on the success path, so a dry run used to
	 * leave one permanently `running` — /datasamling then showed an import that never finished and
	 * never happened. A flag that promises to write nothing must not write the one row the status
	 * board is built from.
	 */
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
	const problems: string[] = [];

	try {
		const { pages, rejected: pageProblems } = await collectPages(read);
		for (const p of pageProblems) {
			rejected += 1;
			problems.push(`page ${p.page}: ${p.problem}`);
		}

		// The same event appears in more than one weekly window when it spans weeks; last write
		// would win harmlessly, but de-duplicating keeps the counts honest.
		const seen = new Set<string>();

		for (const page of pages) {
			for (const raw of page.events) {
				fetched += 1;
				const mapped = mapEvent(raw);
				if (isFailure(mapped)) {
					rejected += 1;
					if (problems.length < 10) problems.push(`${mapped.externalId}: ${mapped.problem}`);
					continue;
				}
				if (seen.has(mapped.externalId)) continue;
				seen.add(mapped.externalId);

				if (dryRun) {
					created += 1;
					continue;
				}

				const venueId = await venueIdFor(db, mapped);
				const organizerId = await organizerIdFor(db, mapped);

				const values = {
					sourceId: source.id,
					externalId: mapped.externalId,
					sourceUrl: mapped.sourceUrl,
					title: mapped.title,
					category: mapped.category,
					startsAt: mapped.startsAt,
					endsAt: mapped.endsAt,
					venueId,
					organizerId,
					ctaUrl: mapped.ctaUrl,
					posterUrl: mapped.posterUrl,
					posterSrcset: mapped.posterSrcset,
					posterRightsVerified: mapped.posterRightsVerified,
					status: source.trusted ? ('published' as const) : ('pending' as const)
				};

				/*
				 * Read before write, so the run reports what actually changed. A blind upsert would
				 * mark all 126 events "updated" every single day, which makes the numbers on
				 * /datasamling noise and hides the one day a source genuinely changes.
				 */
				const [existing] = await db
					.select({
						id: events.id,
						title: events.title,
						category: events.category,
						startsAt: events.startsAt,
						endsAt: events.endsAt,
						venueId: events.venueId,
						organizerId: events.organizerId,
						ctaUrl: events.ctaUrl,
						posterUrl: events.posterUrl,
						posterSrcset: events.posterSrcset,
						posterRightsVerified: events.posterRightsVerified,
						status: events.status
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
					existing.category === values.category &&
					+existing.startsAt === +values.startsAt &&
					(existing.endsAt?.getTime() ?? null) === (values.endsAt?.getTime() ?? null) &&
					existing.venueId === values.venueId &&
					existing.organizerId === values.organizerId &&
					existing.ctaUrl === values.ctaUrl &&
					existing.posterUrl === values.posterUrl &&
					existing.posterSrcset === values.posterSrcset &&
					existing.posterRightsVerified === values.posterRightsVerified &&
					existing.status === values.status;

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
		}

		const status: IngestResult['status'] = rejected > 0 ? 'partial' : 'success';
		const finishedAt = now();
		const durationMs = finishedAt.getTime() - startedAt.getTime();
		const message = problems.length ? problems.join('; ').slice(0, 2000) : null;

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
