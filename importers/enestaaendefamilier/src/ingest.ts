import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, organizers, sources, venues } from '@hendingar/core/schema';
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
	/** Map and count, write nothing. For inspecting a source change safely. */
	dryRun?: boolean;
	now?: () => Date;
};

/**
 * More pages than this is not a local group's calendar, it is a pager gone wrong — and following
 * it would be a crawl of somebody's volunteer-run site. Stord has one page.
 */
const MAX_PAGES = 10;

async function upsertSource(db: Db, group: EfGroup) {
	const shared = {
		name: group.name,
		url: groupUrl(group),
		endpoint: groupUrl(group),
		kind: 'html' as const,
		/*
		 * Written on every run, not left to whatever was there before — the importer owns the note,
		 * because the note describes how we collect it.
		 */
		note:
			'Aktivitetane til lokalgruppa, frå gruppesida og kvar aktivitet si eiga side. Dato, ' +
			'klokkeslett og adresse står i informasjonsboksen på sida; påmeldinga skjer der, med ' +
			'innlogging, så vi lenkjer dit i staden for å ta henne over.',
		active: true,
		scheduleCron: group.scheduleCron,
		iconUrl: group.iconUrl,
		trusted: group.trusted
	};
	const [row] = await db
		.insert(sources)
		.values({ slug: group.slug, region: group.region, attribution: group.attribution, ...shared })
		.onConflictDoUpdate({ target: sources.slug, set: shared })
		.returning();
	if (!row) throw new Error(`could not register the source ${group.slug}`);
	return row;
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
	const {
		fetcher = read,
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db, group);

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
	let recommended = 0;
	const problems: string[] = [];

	try {
		const listing = await readCards(fetcher, group);
		for (const problem of listing.rejected) {
			rejected += 1;
			if (problems.length < 10) problems.push(`invalid card: ${problem}`);
		}

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

		const organizerId = dryRun ? null : await organizerIdFor(db, group.organizer);

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

			fetched += 1;
			let mapped: ReturnType<typeof mapActivity>;
			try {
				mapped = mapActivity(
					card,
					parseActivity(await fetcher(activityUrl(card.activityId))),
					group
				);
			} catch (error) {
				rejected += 1;
				sweepIsSafe = false;
				if (problems.length < 10)
					problems.push(
						`${card.activityId}: ${error instanceof Error ? error.message : String(error)}`
					);
				continue;
			}
			if (isFailure(mapped)) {
				rejected += 1;
				sweepIsSafe = false;
				if (problems.length < 10)
					problems.push(`${mapped.title || mapped.externalId}: ${mapped.problem}`);
				continue;
			}
			if (present.has(mapped.externalId)) continue;
			present.add(mapped.externalId);

			if (dryRun) {
				created += 1;
				continue;
			}

			const venueId = await venueIdFor(db, mapped, group);

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
				organizerId,
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
					organizerId: events.organizerId,
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
				existing.organizerId === values.organizerId &&
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

		/*
		 * What the group has stopped listing. Safe only because the run followed every page —
		 * `listingIsComplete` says so beside the URLs that make it true — and only on a run that
		 * read every activity it listed. Nothing is deleted; see `markGoneUpstream`.
		 */
		let swept = { marked: 0, restored: 0 };
		if (group.listingIsComplete && sweepIsSafe && !dryRun) {
			swept = await markGoneUpstream(db, { sourceId: source.id, seen: present, now: now() });
		}

		const status: IngestResult['status'] = rejected > 0 ? 'partial' : 'success';
		const finishedAt = now();
		const durationMs = finishedAt.getTime() - startedAt.getTime();
		const notes = [
			// Recorded even on a clean run: the only place the cards we decline are visible.
			recommended > 0 ? `${recommended} recommended from other groups, not imported` : null,
			swept.marked > 0 ? `${swept.marked} no longer listed by the source` : null,
			swept.restored > 0 ? `${swept.restored} listed again` : null,
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
			slug: group.slug,
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
 * Every configured group. One failing group must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const results: IngestResult[] = [];
	for (const group of GROUPS) {
		try {
			results.push(await ingestGroup(connectionString, group, options));
		} catch (error) {
			results.push({
				runId: -1,
				slug: group.slug,
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
