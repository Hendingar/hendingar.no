import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@hendingar/core/db';
import { events, ingestRuns, sources, venues } from '@hendingar/core/schema';
import {
	ENDPOINT,
	createPacer,
	fetchAll,
	parseDetail,
	readDetail,
	readEvents,
	wait,
	type Pace,
	type ReadDetail,
	type ReadEvents,
	type UpstreamDetail,
	type Wait
} from './api.ts';
import { ORGANISERS, organiserUrl, type AlleventsOrganiser } from './organisers.ts';
import { cleanEventUrl, isFailure, mapEvent, preferDescription, type MappedEvent } from './map.ts';

/**
 * Deterministic: fetch → parse → validate → upsert. No language model touches this path.
 *
 * One `ingest_runs` row per organiser per execution, including failures — /datasamling renders that
 * table, and a source that stops reporting must become visible rather than quietly stale. Four
 * organisers therefore produce four rows and four lines on the page, not one combined run. They
 * share an `endpoint`, which is what marks them as one platform.
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
	readEvents?: ReadEvents;
	readDetail?: ReadDetail;
	/** Injected so tests wait for nothing — see `Wait` in api.ts. */
	wait?: Wait;
	pace?: Pace;
	trigger?: string;
	revision?: string | null;
	dryRun?: boolean;
	now?: () => Date;
};

async function upsertSource(db: Db, organiser: AlleventsOrganiser) {
	const shared = {
		name: organiser.name,
		url: organiserUrl(organiser),
		endpoint: ENDPOINT,
		kind: 'json-api' as const,
		note:
			'Arrangøren har ei opa side på allevents.in. Vi les det same JSON-kallet som sida deira ' +
			'sjølv gjer, filtrert på denne arrangøren, og hentar omtalen frå sida til kvar hending.',
		/*
		 * Explicitly active.
		 *
		 * A source can arrive here already existing as a `link` row, which the directory registers
		 * with `active: false` because nothing was collecting it. Graduating it without flipping this
		 * back leaves a source that publishes events while being excluded from every count that means
		 * "places this list comes from" — visible on the page, invisible in the numbers.
		 */
		active: true,
		scheduleCron: organiser.scheduleCron,
		iconUrl: organiser.iconUrl,
		trusted: organiser.trusted
	};
	const [row] = await db
		.insert(sources)
		.values({
			slug: organiser.slug,
			region: organiser.region,
			// Attributed to the organiser, not the directory: these are their events, and allevents.in
			// is where they happen to be readable without a Facebook account.
			attribution: organiser.name,
			...shared
		})
		.onConflictDoUpdate({ target: sources.slug, set: shared })
		.returning();
	if (!row) throw new Error(`could not register the source ${organiser.slug}`);
	return row;
}

async function venueIdFor(db: Db, mapped: MappedEvent, organiser: AlleventsOrganiser) {
	const [row] = await db
		.insert(venues)
		.values({
			name: mapped.venueName,
			slug: mapped.venueSlug,
			/*
			 * Not filled in, deliberately.
			 *
			 * `venue.city` is empty for three of the four organisers and wrong for the fourth — Sagvåg
			 * Bygdalag's hall in Sagvåg is filed under "Ølen", forty kilometres away — and
			 * `venue.state` says "RO" for every Norwegian event. The only place a real place name
			 * appears is inside `street` ("… 5410 Sagvåg, Norge"), and that is a postal town, which is
			 * not a municipality: Leirvik is in Stord and Svortland is in Bømlo. Writing a postal town
			 * into a column called `municipality` would be wrong in a way nothing downstream could
			 * detect, so it is left null for the geocoder to fill properly.
			 */
			municipality: null,
			timezone: organiser.timezone,
			// allevents.in does publish coordinates, and they look right. Geocoding is a separate
			// concern with its own status column, and no importer here writes them — flagged rather
			// than half-filled, the same call `importers/billetto` made.
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({ target: venues.slug, set: { name: mapped.venueName } })
		.returning({ id: venues.id });
	return row?.id ?? null;
}

export async function ingestOrganiser(
	connectionString: string,
	organiser: AlleventsOrganiser,
	options: IngestOptions = {}
): Promise<IngestResult> {
	const {
		readEvents: listing = readEvents,
		readDetail: detail = readDetail,
		wait: waitFor = wait,
		pace = createPacer(waitFor),
		trigger = 'manual',
		revision = null,
		dryRun = false,
		now = () => new Date()
	} = options;

	const db = createDb(connectionString);
	const startedAt = now();
	const source = await upsertSource(db, organiser);

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
		const parsed = await fetchAll(organiser, listing, pace);
		for (const problem of parsed.rejected) {
			rejected += 1;
			if (problems.length < 10) problems.push(`invalid record: ${problem}`);
		}

		const seen = new Set<string>();

		for (const raw of parsed.events) {
			fetched += 1;

			/*
			 * The description lives only on the event's own page, and that is one HTTP request per
			 * event. A failure there is not a failure of the event — we still have its title, time,
			 * place, category and poster from the endpoint — so it degrades to an event without a
			 * description rather than losing the row, and rather than losing the other seven.
			 *
			 * The failure is *reported*, though: it lands in the run's message and turns the run
			 * `partial`, so a page that has started 500ing for everyone is visible on /datasamling
			 * instead of showing up as descriptions quietly going missing.
			 */
			let detailData: UpstreamDetail | null = null;
			let detailFailed = false;
			/*
			 * The same normalisation the stored `sourceUrl` gets, and for the same two reasons: the
			 * path carries the organiser's own ø and å and must be percent-encoded, and any `?ref=`
			 * has to come off before we request it — robots.txt disallows those explicitly.
			 */
			const detailUrl = cleanEventUrl(raw.event_url);
			try {
				if (!detailUrl) throw new Error(`unusable event_url: ${raw.event_url}`);
				await pace();
				detailData = parseDetail(await detail(detailUrl));
			} catch (error) {
				detailFailed = true;
				rejected += 1;
				if (problems.length < 10) {
					problems.push(
						`detail for ${detailUrl ?? raw.event_url} failed: ${
							error instanceof Error ? error.message : String(error)
						}`
					);
				}
			}

			const mapped = mapEvent(raw, detailData, organiser);
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

			const venueId = await venueIdFor(db, mapped, organiser);

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
					posterSrcset: events.posterSrcset,
					posterRightsVerified: events.posterRightsVerified,
					status: events.status,
					sourceUrl: events.sourceUrl
				})
				.from(events)
				.where(and(eq(events.sourceId, source.id), eq(events.externalId, mapped.externalId)))
				.limit(1);

			/*
			 * A description we already hold is never thrown away for a degraded copy — not for a page
			 * that 500'd, and not for the stripped template allevents.in serves at random. The rule
			 * and the measurements behind it live in `preferDescription`.
			 */
			const description = preferDescription(existing?.description ?? null, mapped.description, {
				failed: detailFailed,
				truncated: detailData?.truncated ?? false
			});

			const values = {
				sourceId: source.id,
				externalId: mapped.externalId,
				sourceUrl: mapped.sourceUrl,
				title: mapped.title,
				description,
				category: mapped.category,
				startsAt: mapped.startsAt,
				endsAt: mapped.endsAt,
				venueId,
				ctaUrl: mapped.ctaUrl,
				posterUrl: mapped.posterUrl,
				posterSrcset: mapped.posterSrcset,
				posterRightsVerified: mapped.posterRightsVerified,
				status: source.trusted ? ('published' as const) : ('pending' as const)
			};

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
				existing.posterSrcset === values.posterSrcset &&
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
		/*
		 * An empty programme is recorded in words, because the counts alone cannot tell it apart from
		 * a run that read a response and understood nothing. A club between seasons legitimately has
		 * nothing on, and `parsePage` has already refused anything that was not a well-formed success
		 * — so this is a fact about the organiser rather than a warning about the code.
		 */
		const notes = [
			fetched === 0 ? 'the organiser lists no upcoming events' : null,
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
			slug: organiser.slug,
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
 * Every configured organiser. One failing profile must not stop the others — they are independent
 * sources that happen to share a parser, so a failure is recorded against that source alone.
 *
 * The pacer is created once and shared, so the crawl delay is honoured across the whole run and not
 * restarted for each organiser: as far as allevents.in is concerned this is one crawler.
 */
export async function ingestAll(
	connectionString: string,
	options: IngestOptions = {}
): Promise<IngestResult[]> {
	const pace = options.pace ?? createPacer(options.wait ?? wait);
	const results: IngestResult[] = [];
	for (const organiser of ORGANISERS) {
		try {
			results.push(await ingestOrganiser(connectionString, organiser, { ...options, pace }));
		} catch (error) {
			results.push({
				runId: -1,
				slug: organiser.slug,
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
