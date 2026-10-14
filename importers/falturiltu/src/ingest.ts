import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, organizers, sources, venues } from '@hendingar/core/schema';
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
	read?: Read;
	trigger?: string;
	revision?: string | null;
	/** Map and count, write nothing. For inspecting a source change safely. */
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db) {
	// One object for both halves, so insert and update cannot drift apart. `slug`, `region` and
	// `attribution` stay insert-only: they are the identity and the credit.
	const shared = {
		name: SITE.name,
		url: programUrl(),
		endpoint: programUrl(),
		note:
			'Festivalprogrammet er ei vanleg nettside. Vi les dato, klokkeslett, stad og billettlenkje ' +
			'frå programsida og omtalen frå WordPress-grensesnittet til sida, med ti sekund mellom ' +
			'dei to kalla slik robots.txt ber om. Mykje av programmet står òg hos Stord kulturhus ' +
			'og Det skjer, og blir slått saman med dei.',
		kind: 'html' as const,
		active: true,
		scheduleCron: SITE.scheduleCron,
		iconUrl: SITE.iconUrl,
		trusted: SITE.trusted
	};
	const [row] = await db
		.insert(sources)
		.values({
			slug: SITE.slug,
			region: SITE.region,
			attribution: SITE.attribution,
			...shared
		})
		.onConflictDoUpdate({ target: sources.slug, set: shared })
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
	const {
		read = fetchProgram,
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
		const { html, items: rawItems } = await read();
		const program = parseProgram(html);
		const items = parseItems(rawItems);
		for (const problem of program.rejected) {
			rejected += 1;
			if (problems.length < 10) problems.push(problem);
		}
		const itemFor = (link: string) => items.find((item) => item.link === link);
		const organizerId = dryRun ? null : await festivalOrganizerId(db);

		const seen = new Set<string>();
		/*
		 * Every event the page still lists, by the key it is stored under. A skipped card (the
		 * festival pass) is not in here, and has never been stored, so the sweep cannot touch it.
		 */
		const present = new Set<string>();
		let skipped = 0;

		{
			for (const card of program.cards) {
				fetched += 1;
				const mapped = mapCard(card, itemFor(card.link));
				if (isSkip(mapped)) {
					skipped += 1;
					continue;
				}
				if (isFailure(mapped)) {
					rejected += 1;
					if (problems.length < 10) problems.push(`${mapped.externalId}: ${mapped.problem}`);
					continue;
				}
				if (seen.has(mapped.externalId)) continue;
				seen.add(mapped.externalId);
				present.add(mapped.externalId);

				if (dryRun) {
					created += 1;
					continue;
				}

				const venueId = await venueIdFor(db, mapped);

				const values = {
					sourceId: source.id,
					externalId: mapped.externalId,
					sourceUrl: mapped.sourceUrl,
					title: mapped.title,
					category: mapped.category,
					startsAt: mapped.startsAt,
					endsAt: null,
					venueId,
					organizerId,
					description: mapped.description,
					ctaUrl: mapped.ctaUrl,
					status: source.trusted ? ('published' as const) : ('pending' as const)
				};

				/*
				 * Read before write, so the run reports what actually changed. A blind upsert would
				 * mark every event "updated" every single day, which makes the numbers on
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
						description: events.description,
						ctaUrl: events.ctaUrl,
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
					existing.category === values.category &&
					+existing.startsAt === +values.startsAt &&
					existing.endsAt === null &&
					existing.venueId === values.venueId &&
					existing.organizerId === values.organizerId &&
					existing.description === values.description &&
					existing.ctaUrl === values.ctaUrl &&
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

		/*
		 * What the site has stopped listing. Safe because the programme page is the whole festival on one page —
		 * `listingIsComplete` says so beside the URL that makes it true. Nothing is deleted.
		 */
		let swept = { marked: 0, restored: 0 };
		if (SITE.listingIsComplete && !dryRun) {
			swept = await markGoneUpstream(db, { sourceId: source.id, seen: present, now: now() });
		}

		const status: IngestResult['status'] = rejected > 0 ? 'partial' : 'success';
		const finishedAt = now();
		const durationMs = finishedAt.getTime() - startedAt.getTime();
		const notes = [
			swept.marked > 0 ? `${swept.marked} no longer listed by the source` : null,
			swept.restored > 0 ? `${swept.restored} listed again` : null,
			skipped > 0 ? `${skipped} card(s) without a clock time skipped (festival pass)` : null,
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
