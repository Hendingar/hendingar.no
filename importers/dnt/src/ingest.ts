import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
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
	listing?: ReadListing;
	details?: ReadDetails;
	trigger?: string;
	revision?: string | null;
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db, association: DntAssociation) {
	const shared = {
		name: association.name,
		url: calendarUrl(association),
		endpoint: `https://www.dnt.no/api/activities?associations=${association.associationId}`,
		kind: 'json-api' as const,
		active: true,
		scheduleCron: association.scheduleCron,
		iconUrl: association.iconUrl,
		trusted: association.trusted
	};
	const [row] = await db
		.insert(sources)
		.values({
			slug: association.slug,
			region: association.region,
			attribution: association.attribution,
			...shared
		})
		.onConflictDoUpdate({ target: sources.slug, set: shared })
		.returning();
	if (!row) throw new Error(`could not register the source ${association.slug}`);
	return row;
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
	const {
		listing = readListing,
		details = readDetails,
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db, association);

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
	const problems: string[] = [];

	try {
		const parsed = await fetchAllPages(association, listing);
		for (const problem of parsed.rejected) {
			rejected += 1;
			if (problems.length < 10) problems.push(`invalid page hit: ${problem}`);
		}

		/*
		 * A co-organised trip is listed by every turlag involved, so the two we import share two
		 * activities. Within one turlag's own pages an id should be unique, but the guard is cheap
		 * and keeps the run counts honest if DNT ever repeats one across pages.
		 */
		const seen = new Set<string>();

		for (const activity of parsed.activities) {
			fetched += 1;

			/*
			 * The description and the sign-up link live behind a second call. A failure there is
			 * not a failure of the activity — we still know its title, time and meeting point — so
			 * it degrades to an event without a description rather than losing the row entirely.
			 */
			let detail = null;
			try {
				detail = parseDetails(await details(activity.id));
			} catch (error) {
				if (problems.length < 10) {
					problems.push(
						`details for ${activity.id} failed: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}

			const mapped = mapActivity(activity, detail, association);
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

			const venueId = await venueIdFor(db, mapped, association);

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
				status: mapped.cancelled
					? ('rejected' as const)
					: source.trusted
						? ('published' as const)
						: ('pending' as const)
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
			slug: association.slug,
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
 * Every configured turlag. One failing calendar must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const results: IngestResult[] = [];
	for (const association of ASSOCIATIONS) {
		try {
			results.push(await ingestAssociation(connectionString, association, options));
		} catch (error) {
			results.push({
				runId: -1,
				slug: association.slug,
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
