import { and, eq, sql } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, organizers, sources, venues } from '@hendingar/core/schema';
import { markGoneUpstream } from '@hendingar/core/gone-upstream';
import { slugify } from '@hendingar/core/slug';
import { describeWeeklyHours, sameWeeklyHours } from '@hendingar/core/weekly-hours';
import { parseListing, read, type Read } from './api.ts';
import { SITES, listingUrl, type FsSite } from './sites.ts';
import { mapListing, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → group → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per site per execution, including failures — /datasamling renders that
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
	/** On a dry run, one line per row that would be written — what `--dry-run` prints. */
	preview: string[];
};

export type IngestOptions = {
	fetcher?: Read;
	trigger?: string;
	revision?: string | null;
	/** Map and count, write no events and no run row. For inspecting a source change safely. */
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db, site: FsSite) {
	// One object for both halves of the upsert, so the two cannot drift — see importers/bomlonr.
	const shared = {
		name: site.name,
		url: listingUrl(site),
		endpoint: listingUrl(site),
		kind: 'html' as const,
		note:
			'Kalenderen til frivilligsentralen listar kvar einaste gong eit fast tilbod møtest, år ' +
			'fram i tid. Vi samlar dei att til det dei er — eitt tilbod med faste dagar og tider — og ' +
			'viser dei under «Faste aktivitetar» på «Alltid ope». Eitt kall om dagen, til den same ' +
			'sida ein lesar opnar.',
		active: true,
		scheduleCron: site.scheduleCron,
		iconUrl: site.iconUrl,
		// A municipal service's own calendar, edited by its own staff — see the column in schema.ts.
		trusted: site.trusted
	};
	const [row] = await db
		.insert(sources)
		.values({ slug: site.slug, region: site.region, attribution: site.attribution, ...shared })
		.onConflictDoUpdate({ target: sources.slug, set: shared })
		.returning();
	if (!row) throw new Error(`could not register the source ${site.slug}`);
	return row;
}

async function venueIdFor(db: Db, mapped: MappedEvent, site: FsSite) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			// Known rather than inferred — see `municipality` in sites.ts.
			municipality: site.municipality,
			address: mapped.venueStreet,
			timezone: site.timezone,
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({
			target: venues.slug,
			set: {
				/*
				 * Only ever filled in, never overwritten or blanked: the slug may be a row another
				 * source created first ("Leirvikstova" is a common name), and what it already says
				 * about the place is not ours to replace.
				 */
				municipality: sql`coalesce(${venues.municipality}, ${site.municipality})`,
				...(mapped.venueStreet
					? { address: sql`coalesce(${venues.address}, ${mapped.venueStreet})` }
					: {})
			}
		})
		.returning({ id: venues.id });
	return row?.id ?? null;
}

/** The organiser's row, keyed on a slug of the name so the same sentral from two sources is one. */
async function organizerIdFor(db: Db, name: string) {
	const slug = slugify(name);
	if (!slug) return null;
	const [row] = await db
		.insert(organizers)
		.values({ slug, name })
		.onConflictDoUpdate({ target: organizers.slug, set: { name } })
		.returning({ id: organizers.id });
	return row?.id ?? null;
}

function previewLine(row: MappedEvent): string {
	const day = (d: Date | null) => (d ? d.toISOString().slice(0, 16) + 'Z' : '—');
	const when = row.weeklyHours
		? `${describeWeeklyHours(row.weeklyHours).lines.join('; ')} [${row.weeklyHours.cadence}]`
		: 'dated';
	return `${row.externalId} | ${row.title} | ${row.venueName ?? '—'} | ${when} | ${day(row.startsAt)} → ${day(row.endsAt)}`;
}

export async function ingestSite(
	connectionString: string,
	site: FsSite,
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
	const source = await upsertSource(db, site);

	// A dry run opens no run row: one left `running` would show an import that never finished.
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
	const preview: string[] = [];

	try {
		const page = parseListing(await fetcher(site));
		const mapped = mapListing(page, site);

		for (const problem of page.rejected) {
			rejected += 1;
			if (problems.length < 10) problems.push(`invalid item: ${problem}`);
		}
		for (const failure of mapped.failures) {
			rejected += 1;
			if (problems.length < 10) problems.push(`${failure.title}: ${failure.problem}`);
		}

		/*
		 * Only what was mapped counts as present. A series rejected for an irregular cadence is
		 * deliberately NOT kept alive: the row we hold says "kvar veke", the page no longer does, and
		 * a timetable we cannot vouch for is worse than none. The sweep takes it out of the listing,
		 * the run is partial, and the problem above names it.
		 */
		const present = new Set<string>();
		fetched = mapped.rows.length + mapped.failures.length;

		for (const row of mapped.rows) {
			present.add(row.externalId);
			if (dryRun) {
				created += 1;
				preview.push(previewLine(row));
				continue;
			}

			const venueId = await venueIdFor(db, row, site);
			const organizerId = await organizerIdFor(db, row.organizerName);

			const values = {
				sourceId: source.id,
				externalId: row.externalId,
				sourceUrl: row.sourceUrl,
				title: row.title,
				/*
				 * No description, and none written: it lives on each occurrence's own page, and one
				 * request per run is the whole budget — see `read` in api.ts. Left out of the values
				 * rather than set to null, so a description contributed later is never blanked.
				 */
				category: row.category,
				startsAt: row.startsAt,
				endsAt: row.endsAt,
				venueId,
				organizerId,
				weeklyHours: row.weeklyHours,
				status: source.trusted ? ('published' as const) : ('pending' as const)
			};

			// Read before write, so a run reports what actually changed.
			const [existing] = await db
				.select({
					id: events.id,
					title: events.title,
					category: events.category,
					startsAt: events.startsAt,
					endsAt: events.endsAt,
					venueId: events.venueId,
					organizerId: events.organizerId,
					weeklyHours: events.weeklyHours,
					status: events.status,
					sourceUrl: events.sourceUrl
				})
				.from(events)
				.where(and(eq(events.sourceId, source.id), eq(events.externalId, row.externalId)))
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
				sameWeeklyHours(existing.weeklyHours, values.weeklyHours) &&
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

		// Safe because the one page is every upcoming occurrence — see `listingIsComplete`.
		let swept = { marked: 0, restored: 0 };
		if (site.listingIsComplete && !dryRun) {
			swept = await markGoneUpstream(db, { sourceId: source.id, seen: present, now: now() });
		}

		const status: IngestResult['status'] = rejected > 0 ? 'partial' : 'success';
		const finishedAt = now();
		const durationMs = finishedAt.getTime() - startedAt.getTime();
		/*
		 * The grouping is recorded on every run, clean or not: it is the one place the page's 674
		 * dates and our four rows are reconciled, and the number that moves first if the sentral
		 * changes how it publishes.
		 */
		const notes = [
			`${mapped.occurrences} dated items on the listing → ${mapped.standing} weekly activities, ${mapped.dated} dated events`,
			swept.marked > 0 ? `${swept.marked} no longer listed by the source` : null,
			swept.restored > 0 ? `${swept.restored} listed again` : null,
			...problems
		].filter(Boolean);
		const message = notes.join('; ').slice(0, 2000);

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
			slug: site.slug,
			status,
			fetched,
			created,
			updated,
			unchanged,
			rejected,
			durationMs,
			message,
			preview
		};
	} catch (error) {
		const finishedAt = now();
		const message = error instanceof Error ? error.message : String(error);
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

/** Every configured site. One failing sentral is recorded against itself and stops no other. */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const results: IngestResult[] = [];
	for (const site of SITES) {
		try {
			results.push(await ingestSite(connectionString, site, options));
		} catch (error) {
			results.push({
				runId: -1,
				slug: site.slug,
				status: 'failed',
				fetched: 0,
				created: 0,
				updated: 0,
				unchanged: 0,
				rejected: 0,
				durationMs: 0,
				message: error instanceof Error ? error.message : String(error),
				preview: []
			});
		}
	}
	return results;
}
