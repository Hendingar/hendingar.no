import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
import {
	monthsFrom,
	parseMonth,
	parsePoster,
	readDetail,
	readMonth,
	type ReadDetail,
	type ReadMonth
} from './api.ts';
import { CAMPUSES, calendarUrl, type HvlCampus } from './campuses.ts';
import { isAtCampus, isFailure, mapEvent, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per campus per execution, including failures — /datasamling renders that
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
	month?: ReadMonth;
	detail?: ReadDetail;
	trigger?: string;
	revision?: string | null;
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db, campus: HvlCampus) {
	const shared = {
		name: campus.name,
		url: calendarUrl(campus),
		endpoint: `https://www.hvl.no/service/calendar/month/nn-NO/{year}/{month}/0/${campus.locationId}`,
		kind: 'json-api' as const,
		active: true,
		scheduleCron: campus.scheduleCron,
		iconUrl: campus.iconUrl,
		trusted: campus.trusted
	};
	const [row] = await db
		.insert(sources)
		.values({
			slug: campus.slug,
			region: campus.region,
			attribution: campus.attribution,
			...shared
		})
		.onConflictDoUpdate({ target: sources.slug, set: shared })
		.returning();
	if (!row) throw new Error(`could not register the source ${campus.slug}`);
	return row;
}

async function venueIdFor(db: Db, mapped: MappedEvent, campus: HvlCampus) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			municipality: null,
			timezone: campus.timezone,
			// The calendar gives a room, never a coordinate. Flagged rather than dropped, so an
			// unplaceable venue is visible to the geocoder instead of vanishing.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestCampus(
	connectionString: string,
	campus: HvlCampus,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const {
		month = readMonth,
		detail = readDetail,
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db, campus);

	/*
	 * A dry run opens no run row: the row is inserted as `running` and only closed on the success
	 * path, so opening one would leave /datasamling showing an import that never finished.
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
	let elsewhere = 0;
	const problems: string[] = [];

	try {
		/*
		 * One request per month. The service has no "everything from here" mode — the Angular
		 * controller pages a month at a time and so must we.
		 */
		const seen = new Set<string>();
		for (const { year, month: m } of monthsFrom(startedAt)) {
			const parsed = parseMonth(await month(campus, year, m));
			for (const problem of parsed.rejected) {
				rejected += 1;
				if (problems.length < 10) problems.push(`invalid item: ${problem}`);
			}

			for (const raw of parsed.events) {
				/*
				 * Tagged with this campus, but is it HERE?
				 *
				 * HVL tags an all-institution event with every campus, so the Stord filter returns
				 * the doctoral ceremony in Bergen and every Zoom webinar. Counted rather than
				 * treated as a rejection: nothing changed shape, these are simply somebody else's
				 * events, and `rejected` is the number that should mean "the source moved".
				 */
				if (!isAtCampus(raw, campus)) {
					elsewhere += 1;
					continue;
				}

				fetched += 1;

				const first = mapEvent(raw, campus, null);
				if (isFailure(first)) {
					rejected += 1;
					if (problems.length < 10)
						problems.push(`${first.title || first.externalId}: ${first.problem}`);
					continue;
				}
				if (seen.has(first.externalId)) continue;
				seen.add(first.externalId);

				/*
				 * The banner lives on the detail page and nowhere else. A failure there costs us a
				 * picture, not the event, so it degrades to no poster rather than losing the row.
				 */
				let poster: string | null = null;
				if (first.detailUrl) {
					try {
						poster = parsePoster(await detail(first.detailUrl));
					} catch (error) {
						if (problems.length < 10) {
							problems.push(
								`poster for ${first.externalId} failed: ${error instanceof Error ? error.message : String(error)}`
							);
						}
					}
				}
				const mapped = { ...first, posterUrl: poster };

				if (dryRun) {
					created += 1;
					continue;
				}

				const venueId = await venueIdFor(db, mapped, campus);

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

				// Read before write, so a run reports what actually changed rather than marking
				// every event "updated" daily and burying the one day a source really moved.
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
		}

		const status: IngestResult['status'] = rejected > 0 ? 'partial' : 'success';
		const finishedAt = now();
		const durationMs = finishedAt.getTime() - startedAt.getTime();
		/*
		 * The count of other-campus rows is recorded even on a clean run.
		 *
		 * It is the one number that shows the location filter is doing its job, and the one that
		 * moves if HVL changes how it tags. A run that suddenly skips nothing, or skips everything,
		 * is visible on /datasamling instead of being a silent change in what we publish.
		 */
		const notes = [
			elsewhere > 0 ? `${elsewhere} rows tagged ${campus.locationId} but held elsewhere` : null,
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
			slug: campus.slug,
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
 * Every configured campus. One failing calendar must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const results: IngestResult[] = [];
	for (const campus of CAMPUSES) {
		try {
			results.push(await ingestCampus(connectionString, campus, options));
		} catch (error) {
			results.push({
				runId: -1,
				slug: campus.slug,
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
