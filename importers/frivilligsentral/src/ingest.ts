import { sql } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import {
	failedResult,
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { organizers, venues } from '@hendingar/core/schema';
import { markGoneUpstream } from '@hendingar/core/gone-upstream';
import { slugify } from '@hendingar/core/slug';
import { describeWeeklyHours } from '@hendingar/core/weekly-hours';
import { parseListing, read, type Read } from './api.ts';
import { SITES, listingUrl, type FsSite } from './sites.ts';
import { mapListing, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → group → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per site per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
 */

export type FrivilligsentralResult = IngestResult & {
	/** On a dry run, one line per row that would be written — what `--dry-run` prints. */
	preview: string[];
};

export type IngestOptions = RunOptions & { fetcher?: Read };

function upsertSource(db: Db, site: FsSite) {
	return registerSource(db, {
		slug: site.slug,
		name: site.name,
		url: listingUrl(site),
		endpoint: listingUrl(site),
		kind: 'html',
		note:
			'Kalenderen til frivilligsentralen listar kvar einaste gong eit fast tilbod møtest, år ' +
			'fram i tid. Vi samlar dei att til det dei er — eitt tilbod med faste dagar og tider — og ' +
			'viser dei under «Faste aktivitetar» på «Alltid ope». Eitt kall om dagen, til den same ' +
			'sida ein lesar opnar.',
		scheduleCron: site.scheduleCron,
		iconUrl: site.iconUrl,
		// A municipal service's own calendar, edited by its own staff — see the column in schema.ts.
		trusted: site.trusted,
		region: site.region,
		attribution: site.attribution
	});
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
): Promise<FrivilligsentralResult> {
	const { fetcher = read } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, site);
	const preview: string[] = [];

	const report = await recordRun(db, source.id, options, async (run) => {
		const page = parseListing(await fetcher(site));
		const mapped = mapListing(page, site);

		for (const problem of page.rejected) run.reject(`invalid item: ${problem}`);
		for (const failure of mapped.failures) run.reject(`${failure.title}: ${failure.problem}`);

		/*
		 * Only what was mapped counts as present. A series rejected for an irregular cadence is
		 * deliberately NOT kept alive: the row we hold says "kvar veke", the page no longer does, and
		 * a timetable we cannot vouch for is worse than none. The sweep takes it out of the listing,
		 * the run is partial, and the problem above names it.
		 */
		const present = new Set<string>();
		run.counts.fetched = mapped.rows.length + mapped.failures.length;

		for (const row of mapped.rows) {
			present.add(row.externalId);
			if (run.dryRun) {
				run.counts.created += 1;
				preview.push(previewLine(row));
				continue;
			}

			const venueId = await venueIdFor(db, row, site);
			const organizerId = await organizerIdFor(db, row.organizerName);

			await run.upsertEvent({
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
				status: source.trusted ? 'published' : 'pending'
			});
		}

		// Safe because the one page is every upcoming occurrence — see `listingIsComplete`.
		let swept = { marked: 0, restored: 0 };
		if (site.listingIsComplete && !run.dryRun) {
			swept = await markGoneUpstream(db, { sourceId: source.id, seen: present, now: run.now() });
		}

		/*
		 * The grouping is recorded on every run, clean or not: it is the one place the page's 674
		 * dates and our four rows are reconciled, and the number that moves first if the sentral
		 * changes how it publishes. Ahead of the problems, and outside their cap.
		 */
		const summary = [
			`${mapped.occurrences} dated items on the listing → ${mapped.standing} weekly activities, ${mapped.dated} dated events`
		];
		if (swept.marked > 0) summary.push(`${swept.marked} no longer listed by the source`);
		if (swept.restored > 0) summary.push(`${swept.restored} listed again`);
		run.problems.unshift(...summary);
	});

	return { slug: site.slug, ...report, preview };
}

/**
 * Every configured site. One failing sentral is recorded against itself and stops no other.
 *
 * Its own loop rather than `ingestEach`, which returns plain `IngestResult`s: the preview would
 * not survive it.
 */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<FrivilligsentralResult[]> {
	const results: FrivilligsentralResult[] = [];
	for (const site of SITES) {
		try {
			results.push(await ingestSite(connectionString, site, options));
		} catch (error) {
			results.push({ ...failedResult(site.slug, error), preview: [] });
		}
	}
	return results;
}
