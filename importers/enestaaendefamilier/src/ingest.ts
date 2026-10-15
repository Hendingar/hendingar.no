import { createDb, type Db } from '@hendingar/core/db';
import {
	ingestEach,
	recordRun,
	registerSource,
	type IngestResult,
	type RunOptions
} from '@hendingar/core/ingest-run';
import { organizers, venues } from '@hendingar/core/schema';
import { markGoneUpstream } from '@hendingar/core/gone-upstream';
import { slugify } from '@hendingar/core/slug';
import {
	parseActivity,
	parseCards,
	parseGroupPage,
	read,
	type Read,
	type UpstreamCard
} from './api.ts';
import { GROUPS, activityUrl, groupUrl, upcomingUrl, type EfGroup } from './groups.ts';
import { isFailure, isOwnActivity, mapActivity, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per group per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale.
 */

export type IngestOptions = RunOptions & { fetcher?: Read };

/**
 * More pages than this is not a local group's calendar, it is a pager gone wrong — and following
 * it would be a crawl of somebody's volunteer-run site. Stord has one page.
 */
const MAX_PAGES = 10;

function upsertSource(db: Db, group: EfGroup) {
	return registerSource(db, {
		slug: group.slug,
		name: group.name,
		url: groupUrl(group),
		endpoint: groupUrl(group),
		kind: 'html',
		/*
		 * Written on every run, not left to whatever was there before — the importer owns the note,
		 * because the note describes how we collect it.
		 */
		note:
			'Aktivitetane til lokalgruppa, frå gruppesida og kvar aktivitet si eiga side. Dato, ' +
			'klokkeslett og adresse står i informasjonsboksen på sida; påmeldinga skjer der, med ' +
			'innlogging, så vi lenkjer dit i staden for å ta henne over.',
		scheduleCron: group.scheduleCron,
		iconUrl: group.iconUrl,
		trusted: group.trusted,
		region: group.region,
		attribution: group.attribution
	});
}

async function venueIdFor(db: Db, mapped: MappedEvent, group: EfGroup) {
	if (!mapped.venueName || !mapped.venueSlug) return null;
	/*
	 * Coordinates come from the source, so the venue is `resolved` rather than `pending` — the
	 * organisers' own pin, not a geocoder's guess (`packages/core/src/address.ts` records why we
	 * do not geocode). The same call `importers/luma` makes.
	 */
	const located = mapped.latitude !== null && mapped.longitude !== null;
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			// One of ours by name, or null — never a post town. See `municipalityOf`.
			municipality: mapped.municipality,
			address: mapped.venueAddress,
			latitude: mapped.latitude,
			longitude: mapped.longitude,
			timezone: group.timezone,
			geocodeStatus: located ? ('resolved' as const) : ('pending' as const)
		})
		.onConflictDoUpdate({
			target: venues.slug,
			set: {
				name: mapped.venueName,
				/*
				 * Only ever filled in, never blanked. A venue row is shared by every source that
				 * names the same place, and a later activity whose title names no municipality must
				 * not erase the one an earlier one established.
				 */
				...(mapped.municipality ? { municipality: mapped.municipality } : {}),
				...(mapped.venueAddress ? { address: mapped.venueAddress } : {}),
				...(located
					? {
							latitude: mapped.latitude,
							longitude: mapped.longitude,
							geocodeStatus: 'resolved' as const
						}
					: {})
			}
		})
		.returning({ id: venues.id });
	return row?.id ?? null;
}

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

/**
 * Every card the group lists, across every page, each once.
 *
 * The group page carries page one inline, so it is not fetched again as a fragment; later pages
 * are. That is the whole list in `pageCount` requests, which is what `listingIsComplete` rests on.
 */
async function readCards(
	fetcher: Read,
	group: EfGroup
): Promise<{ cards: UpstreamCard[]; rejected: string[] }> {
	const first = parseGroupPage(await fetcher(groupUrl(group)));
	if (first.pageCount > MAX_PAGES) {
		throw new Error(`the group page reports ${first.pageCount} pages; refusing to crawl them`);
	}
	const cards = [...first.cards];
	const rejected = [...first.rejected];
	for (let page = 2; page <= first.pageCount; page += 1) {
		const next = parseCards(await fetcher(upcomingUrl(group, page)));
		cards.push(...next.cards);
		rejected.push(...next.rejected);
	}
	const byId = new Map(cards.map((card) => [card.activityId, card]));
	return { cards: [...byId.values()], rejected };
}

export async function ingestGroup(
	connectionString: string,
	group: EfGroup,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const { fetcher = read } = options;
	const db = createDb(connectionString);
	const source = await upsertSource(db, group);

	const report = await recordRun(db, source.id, options, async (run) => {
		let recommended = 0;

		const listing = await readCards(fetcher, group);
		for (const problem of listing.rejected) run.reject(`invalid card: ${problem}`);

		/*
		 * The external ids of every activity this group still lists — what the sweep compares.
		 *
		 * Only trustworthy when every listed activity was read: an activity whose page failed to
		 * load or to map has no id we can compute, and its row would be marked gone on a
		 * technicality. So any such failure turns the sweep off for the run, and a later clean run
		 * puts it right.
		 */
		const present = new Set<string>();
		let sweepIsSafe = listing.rejected.length === 0;

		const organizerId = run.dryRun ? null : await organizerIdFor(db, group.organizer);

		for (const card of listing.cards) {
			/*
			 * Another group's activity, recommended on this group's list. Counted apart from
			 * `rejected`, which must go on meaning "the source moved": nothing is wrong with these,
			 * they are simply some other group's to report — usually somewhere we do not cover.
			 */
			if (!isOwnActivity(card, group)) {
				recommended += 1;
				continue;
			}

			run.counts.fetched += 1;
			let mapped: ReturnType<typeof mapActivity>;
			try {
				mapped = mapActivity(
					card,
					parseActivity(await fetcher(activityUrl(card.activityId))),
					group
				);
			} catch (error) {
				sweepIsSafe = false;
				run.reject(`${card.activityId}: ${error instanceof Error ? error.message : String(error)}`);
				continue;
			}
			if (isFailure(mapped)) {
				sweepIsSafe = false;
				run.reject(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}
			if (present.has(mapped.externalId)) continue;
			present.add(mapped.externalId);

			if (run.dryRun) {
				run.counts.created += 1;
				continue;
			}

			// No ctaUrl: the mapping has none, and this importer has never written one.
			await run.upsertEvent({
				sourceId: source.id,
				externalId: mapped.externalId,
				sourceUrl: mapped.sourceUrl,
				title: mapped.title,
				description: mapped.description,
				category: mapped.category,
				startsAt: mapped.startsAt,
				endsAt: mapped.endsAt,
				venueId: await venueIdFor(db, mapped, group),
				organizerId,
				posterUrl: mapped.posterUrl,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? 'published' : 'pending'
			});
		}

		/*
		 * What the group has stopped listing. Safe only because the run followed every page —
		 * `listingIsComplete` says so beside the URLs that make it true — and only on a run that
		 * read every activity it listed. Nothing is deleted; see `markGoneUpstream`.
		 */
		let swept = { marked: 0, restored: 0 };
		if (group.listingIsComplete && sweepIsSafe && !run.dryRun) {
			swept = await markGoneUpstream(db, { sourceId: source.id, seen: present, now: run.now() });
		}

		/*
		 * Ahead of the problems and outside their cap, as they always were: one-line summaries
		 * of the run, worth more than the eleventh rejection.
		 */
		const summary = [
			// Recorded even on a clean run: the only place the cards we decline are visible.
			recommended > 0 ? `${recommended} recommended from other groups, not imported` : null,
			swept.marked > 0 ? `${swept.marked} no longer listed by the source` : null,
			swept.restored > 0 ? `${swept.restored} listed again` : null
		].filter((line) => line !== null);
		run.problems.unshift(...summary);
	});

	return { slug: group.slug, ...report };
}

/**
 * Every configured group. One failing group must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 */
export function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	return ingestEach(GROUPS, (group) => ingestGroup(connectionString, group, options));
}
