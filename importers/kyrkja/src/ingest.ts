import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
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
	read?: FetchCalendar;
	trigger?: string;
	revision?: string | null;
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db, instance: KyrkjaInstance) {
	const shared = {
		name: instance.name,
		url: instance.url,
		endpoint: instance.url,
		/*
		 * Replaces the note this row carried while it was a `link`, which said we did NOT collect
		 * it. Graduating a source without clearing that would leave /datasamling explaining why we
		 * cannot fetch a calendar it is, at that moment, showing fresh events from.
		 */
		note: 'Kalenderen ligg JSON-koda inne i sida og blir sett inn av JavaScript. Vi pakkar ut den strengen og les han direkte — ingen nettlesar involvert.',
		kind: 'html' as const,
		/*
		 * Explicitly active.
		 *
		 * A source can arrive here already existing as a `link` row, which the directory registers
		 * with `active: false` because nothing was collecting it. Graduating it without flipping
		 * this back leaves a source that publishes events while being excluded from every count
		 * that means "places this list comes from" — visible on the page, invisible in the numbers.
		 */
		active: true,
		scheduleCron: instance.scheduleCron,
		iconUrl: instance.iconUrl,
		trusted: instance.trusted
	};
	const [row] = await db
		.insert(sources)
		.values({
			slug: instance.slug,
			region: instance.region,
			attribution: instance.attribution,
			...shared
		})
		.onConflictDoUpdate({ target: sources.slug, set: shared })
		.returning();
	if (!row) throw new Error(`could not register the source ${instance.slug}`);
	return row;
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
	const {
		read = fetchCalendar,
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db, instance);

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
	// Private family occasions we deliberately do not republish — see isPrivateOccasion.
	let withheld = 0;
	const problems: string[] = [];

	try {
		/*
		 * Fail loudly if the blob is gone.
		 *
		 * A redesign that stops embedding the calendar would otherwise parse to zero events and
		 * report success — the importer's own definition of "the source went quiet" has to be an
		 * error, not an empty list.
		 */
		const calendarHtml = extractCalendarHtml(await read(instance));
		if (!calendarHtml) {
			throw new Error('no calendar payload in the page — the embedded JSON blob is gone');
		}

		const parsed = parseCalendar(calendarHtml, instance.url);
		for (const problem of parsed.rejected) {
			rejected += 1;
			if (problems.length < 10) problems.push(problem);
		}

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

			fetched += 1;
			const mapped = mapEvent(raw, instance);
			if (isFailure(mapped)) {
				rejected += 1;
				if (problems.length < 10)
					problems.push(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}
			if (seen.has(mapped.externalId)) continue;
			seen.add(mapped.externalId);

			if (dryRun) {
				created += 1;
				continue;
			}

			const venueId = await venueIdFor(db, mapped, instance);

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
				existing.description === values.description &&
				existing.category === values.category &&
				+existing.startsAt === +values.startsAt &&
				(existing.endsAt?.getTime() ?? null) === (values.endsAt?.getTime() ?? null) &&
				existing.venueId === values.venueId &&
				existing.ctaUrl === values.ctaUrl &&
				existing.posterUrl === values.posterUrl &&
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

		const status: IngestResult['status'] = rejected > 0 ? 'partial' : 'success';
		const finishedAt = now();
		const durationMs = finishedAt.getTime() - startedAt.getTime();
		/*
		 * The withheld count is recorded even on a clean run.
		 *
		 * It is the only place the decision not to republish funerals and weddings is visible. A
		 * run that suddenly withholds nothing means the parish relabelled them, and that should be
		 * noticeable on /datasamling rather than a silent change in what we publish.
		 */
		const notes = [
			withheld > 0 ? `${withheld} private occasions withheld (gravferd/vigsel)` : null,
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
			slug: instance.slug,
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
 * Every configured instance. One failing site must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const results: IngestResult[] = [];
	for (const instance of INSTANCES) {
		try {
			results.push(await ingestInstance(connectionString, instance, options));
		} catch (error) {
			results.push({
				runId: -1,
				slug: instance.slug,
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
