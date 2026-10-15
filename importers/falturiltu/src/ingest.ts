import { createDb, type Db } from '@hendingar/core/db';
import {
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { organizers, venues } from '@hendingar/core/schema';
import { markGoneUpstream } from '@hendingar/core/gone-upstream';
import { parseItems, parseProgram, read as fetchProgram, type Read } from './api.ts';
import { SITE, programUrl } from './site.ts';
import { isFailure, isSkip, mapCard, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → validate → map → upsert. No language model touches this path.
 *
 * Every execution writes an `ingest_runs` row, including failures. That row is what /datasamling
 * renders — without it the page could claim a source is collected but never show that it was.
 */

export type IngestOptions = RunOptions & { read?: Read };

function upsertSource(db: Db) {
	return registerSource(db, {
		slug: SITE.slug,
		name: SITE.name,
		url: programUrl(),
		endpoint: programUrl(),
		note:
			'Festivalprogrammet er ei vanleg nettside. Vi les dato, klokkeslett, stad og billettlenkje ' +
			'frå programsida og omtalen frå WordPress-grensesnittet til sida, med ti sekund mellom ' +
			'dei to kalla slik robots.txt ber om. Mykje av programmet står òg hos Stord kulturhus ' +
			'og Det skjer, og blir slått saman med dei.',
		kind: 'html',
		scheduleCron: SITE.scheduleCron,
		iconUrl: SITE.iconUrl,
		trusted: SITE.trusted,
		region: SITE.region,
		attribution: SITE.attribution
	});
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
			timezone: SITE.timezone,
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

/** The festival runs its own programme; partners are named in the description, not here. */
async function festivalOrganizerId(db: Db): Promise<number | null> {
	const [row] = await db
		.insert(organizers)
		.values({ name: SITE.name, slug: SITE.slug })
		.onConflictDoUpdate({ target: organizers.slug, set: { name: SITE.name } })
		.returning({ id: organizers.id });
	return row?.id ?? null;
}

export async function ingest(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { read = fetchProgram } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db);

	const report = await recordRun(db, source.id, options, async (run) => {
		const { html, items: rawItems } = await read();
		const program = parseProgram(html);
		const items = parseItems(rawItems);
		for (const problem of program.rejected) run.reject(problem);
		const itemFor = (link: string) => items.find((item) => item.link === link);
		const organizerId = run.dryRun ? null : await festivalOrganizerId(db);

		const seen = new Set<string>();
		/*
		 * Every event the page still lists, by the key it is stored under. A skipped card (the
		 * festival pass) is not in here, and has never been stored, so the sweep cannot touch it.
		 */
		const present = new Set<string>();
		let skipped = 0;

		for (const card of program.cards) {
			run.counts.fetched += 1;
			const mapped = mapCard(card, itemFor(card.link));
			if (isSkip(mapped)) {
				skipped += 1;
				continue;
			}
			if (isFailure(mapped)) {
				run.reject(`${mapped.externalId}: ${mapped.problem}`);
				continue;
			}
			if (seen.has(mapped.externalId)) continue;
			seen.add(mapped.externalId);
			present.add(mapped.externalId);

			if (run.dryRun) {
				run.counts.created += 1;
				continue;
			}

			await run.upsertEvent({
				sourceId: source.id,
				externalId: mapped.externalId,
				sourceUrl: mapped.sourceUrl,
				title: mapped.title,
				category: mapped.category,
				startsAt: mapped.startsAt,
				endsAt: null,
				venueId: await venueIdFor(db, mapped),
				organizerId,
				description: mapped.description,
				ctaUrl: mapped.ctaUrl,
				status: source.trusted ? 'published' : 'pending'
			});
		}

		/*
		 * What the site has stopped listing. Safe because the programme page is the whole festival on one page —
		 * `listingIsComplete` says so beside the URL that makes it true. Nothing is deleted.
		 */
		let swept = { marked: 0, restored: 0 };
		if (SITE.listingIsComplete && !run.dryRun) {
			swept = await markGoneUpstream(db, { sourceId: source.id, seen: present, now: run.now() });
		}

		/*
		 * Ahead of the problems and outside their cap, as they always were: one-line summaries
		 * of the run, worth more than the eleventh rejection.
		 */
		const summary = [
			swept.marked > 0 ? `${swept.marked} no longer listed by the source` : null,
			swept.restored > 0 ? `${swept.restored} listed again` : null,
			skipped > 0 ? `${skipped} card(s) without a clock time skipped (festival pass)` : null
		].filter((line) => line !== null);
		run.problems.unshift(...summary);
	});

	return { slug: SITE.slug, ...report };
}
