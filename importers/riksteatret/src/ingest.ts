import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
import {
	createPacer,
	parseVenuePage,
	readVenuePage,
	type Pace,
	type ReadVenuePage
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
	read?: ReadVenuePage;
	pace?: Pace;
	trigger?: string;
	revision?: string | null;
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db, instance: RiksteatretInstance) {
	const shared = {
		name: instance.name,
		url: instance.url,
		endpoint: instance.url,
		kind: 'html' as const,
		/*
		 * Replaces the note this row carried while it was a `link`, which said we planned to
		 * collect it one day. Graduating a source without rewriting that would leave /datasamling
		 * promising future coverage of a calendar it is, at that moment, showing fresh events from.
		 */
		note: 'Programmet for spelestaden på riksteatret.no. Sida er server-rendra HTML utan feed, så vi les kvar framsyning rett frå datetime-attributtet på programkortet.',
		/*
		 * Explicitly active.
		 *
		 * `riksteatret-bomlo` already exists as a `link` row: `pnpm db:sources` registered it from
		 * `LINKED_SOURCES` with `active: false`, no endpoint and no schedule. Graduating it without
		 * flipping this back leaves a source that publishes events while being excluded from every
		 * count that means "places this list comes from" — visible on the page, invisible in the
		 * numbers.
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
	const {
		read = readVenuePage,
		pace = createPacer(),
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db, instance);

	/*
	 * A dry run opens no run row. The row is inserted as `running` and only closed on the success
	 * path, so opening one here would leave /datasamling showing an import that never finished and
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

		for (const problem of page.rejected) {
			rejected += 1;
			if (problems.length < 10) problems.push(problem);
		}

		// The same performance is never printed twice on a page, but a template change that
		// repeated one must not double the counts.
		const seen = new Set<string>();

		for (const raw of page.performances) {
			fetched += 1;
			const mapped = mapPerformance(
				raw,
				page.postersByProduction.get(raw.productionId) ?? null,
				instance
			);
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
 * Every configured venue. One failing page must not stop the others — they are independent sources
 * that happen to share a parser, so a failure is recorded against that source alone.
 *
 * The pacer is created once and shared, because the crawl delay is about the site, not about a
 * single venue: a run walking several halls is one crawler as far as riksteatret.no is concerned.
 */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const pace = options.pace ?? createPacer();
	const results: IngestResult[] = [];
	for (const instance of INSTANCES) {
		try {
			results.push(await ingestInstance(connectionString, instance, { ...options, pace }));
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
