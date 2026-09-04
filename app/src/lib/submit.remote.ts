import { command, form, query } from '$app/server';
import { z } from 'zod';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import { eventSeries, events, organizers, venues, verifications } from '@hendingar/core/schema';
import { eventFormSchema } from '@hendingar/core/validation';
import { instantToZonedWallClock, zonedWallClockToInstant } from '@hendingar/core/datetime';
import { DUPLICATE_WINDOW_MS, comparePair } from '@hendingar/core/consolidate';
import { submissionCutoff } from '@hendingar/core/submissions';
import { eventPath } from '@hendingar/core/slug';
import {
	HORIZON_WEEKS,
	RECURRENCE_FREQUENCIES,
	describeRecurrence,
	expandRecurrence,
	type Recurrence,
	type Weekday
} from '@hendingar/core/recurrence';
import { db } from './server/db';
import { extractPoster, verifierEnabled, verifyEvent } from './server/verifier';

/**
 * Event submission — the form, the photo shortcut, and the verification that gates both.
 *
 * A submitted event is never published on the model's say-so alone. It is stored, every check
 * records its reasoning in `verifications`, and only a unanimous confident pass publishes
 * directly. Everything else waits for a person. See services/verifier/README.md.
 */

/**
 * Is this event already here?
 *
 * Asked as soon as the date, time and title are known — which after an extraction is before the
 * person has filled in anything at all. Finding out at the end, having typed a description and a
 * venue, is the worst possible moment to learn the work was unnecessary.
 *
 * The comparison is the same `comparePair` that `pnpm consolidate` uses across sources, so what
 * counts as a duplicate on submission is what counts as a duplicate everywhere else. A submission
 * has no `sourceId`, which is exactly right here: the rule that a source never duplicates itself
 * is about repeat sessions of one calendar, and a person sending in a poster is not that.
 */
const duplicateProbeSchema = z.object({
	title: z.string().trim().min(1).max(300),
	/** Local date and time as the form holds them, resolved against the venue's zone. */
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	startTime: z.string().regex(/^\d{2}:\d{2}$/),
	timeZone: z.string().trim().min(1).max(64),
	venueName: z.string().trim().max(200).nullable().default(null)
});

export const findDuplicate = query(duplicateProbeSchema, async (probe) => {
	const startsAt = zonedWallClockToInstant(probe.date, probe.startTime, probe.timeZone);

	/*
	 * Shortlist in SQL, decide in code.
	 *
	 * The window is the same hour `consolidate` allows, widened by nothing: a day would offer the
	 * Wednesday showing of a play as a duplicate of the Tuesday one, which is a different evening
	 * with different tickets.
	 */
	const from = new Date(startsAt.getTime() - DUPLICATE_WINDOW_MS);
	const to = new Date(startsAt.getTime() + DUPLICATE_WINDOW_MS);

	const candidates = await db()
		.select({
			id: events.id,
			sourceId: events.sourceId,
			title: events.title,
			startsAt: events.startsAt,
			venueName: venues.name,
			posterUrl: events.posterUrl,
			venueTimeZone: venues.timezone
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(
			and(
				gte(events.startsAt, from),
				lte(events.startsAt, to),
				eq(events.status, 'published'),
				// Only canonical rows: offering someone a duplicate OF a duplicate is a maze.
				isNull(events.duplicateOfId)
			)
		)
		.limit(50);

	const probeCandidate = {
		id: -1,
		sourceId: null,
		title: probe.title,
		startsAt,
		venueName: probe.venueName
	};

	let best: {
		id: number;
		title: string;
		startsAt: Date;
		venueName: string | null;
		venueTimeZone: string | null;
		posterUrl: string | null;
		path: string;
		score: number;
	} | null = null;

	for (const candidate of candidates) {
		const verdict = comparePair(probeCandidate, candidate);
		if (!verdict.same) continue;
		if (best && best.score >= verdict.score) continue;
		best = {
			id: candidate.id,
			title: candidate.title,
			startsAt: candidate.startsAt,
			venueName: candidate.venueName,
			venueTimeZone: candidate.venueTimeZone,
			posterUrl: candidate.posterUrl,
			path: eventPath(candidate.id, candidate.title),
			score: verdict.score
		};
	}

	return best;
});

/**
 * This browser's own submissions, and why each one did or did not go out.
 *
 * The queue is per-browser and needs no account: `clientId` is the same opaque, browser-generated
 * value the hearts use. It answers "show me mine" and nothing else — see the column comment in
 * schema.ts for why that is a proportionate amount of security for an unpublished event listing.
 *
 * Approved submissions are included on purpose. A queue that only ever shows failures teaches
 * people the system is a wall; showing the ones that went out is what makes the list a record of
 * what they contributed.
 */
export const mySubmissions = query(
	z.object({
		clientId: z
			.string()
			.trim()
			.min(8)
			.max(64)
			.regex(/^[A-Za-z0-9-]+$/, 'client id must be opaque')
	}),
	async ({ clientId }) => {
		const database = db();
		const rows = await database
			.select({
				id: events.id,
				title: events.title,
				description: events.description,
				category: events.category,
				startsAt: events.startsAt,
				endsAt: events.endsAt,
				status: events.status,
				outcome: events.submissionOutcome,
				method: events.submissionMethod,
				sourceUrl: events.sourceUrl,
				ctaUrl: events.ctaUrl,
				notes: events.verificationNotes,
				appealedAt: events.appealedAt,
				appealText: events.appealText,
				appealVerdicts: events.appealVerdicts,
				createdAt: events.createdAt,
				updatedAt: events.updatedAt,
				duplicateOfId: events.duplicateOfId,
				venueName: venues.name,
				venueMunicipality: venues.municipality,
				venueTimeZone: venues.timezone
			})
			.from(events)
			.leftJoin(venues, eq(events.venueId, venues.id))
			.where(
				and(
					eq(events.submitterClientId, clientId),
					// Occurrences of a series share a submission; show the anchor, not thirty rows.
					isNull(events.seriesId),
					/*
					 * Past its two days, and already gone as far as anyone can tell.
					 *
					 * Filtered on read as well as swept in the nightly job, so the page never lists
					 * something that no longer exists in any meaningful sense. Published events are
					 * exempt: they are the site's content, not somebody's draft.
					 */
					or(eq(events.status, 'published'), gte(events.updatedAt, submissionCutoff()))
				)
			)
			.orderBy(desc(events.updatedAt))
			.limit(50);

		if (rows.length === 0) return [];

		/*
		 * The reasoning, in one query rather than one per row.
		 *
		 * The whole point of the page is answering "why", so the checks are not optional detail —
		 * fetching them lazily would mean the page renders the question and not the answer.
		 */
		const ids = rows.map((r) => r.id);
		const allChecks = await database
			.select({
				eventId: verifications.eventId,
				check: verifications.check,
				verdict: verifications.verdict,
				confidence: verifications.confidence,
				reasoning: verifications.reasoning,
				deterministic: verifications.deterministic,
				model: verifications.model
			})
			.from(verifications)
			.where(inArray(verifications.eventId, ids))
			.orderBy(asc(verifications.id));

		const duplicateIds = rows.map((r) => r.duplicateOfId).filter((id): id is number => id !== null);
		const duplicates = duplicateIds.length
			? await database
					.select({ id: events.id, title: events.title })
					.from(events)
					.where(inArray(events.id, duplicateIds))
			: [];

		return rows.map((row) => {
			const dupe = duplicates.find((d) => d.id === row.duplicateOfId);
			return {
				...row,
				path: eventPath(row.id, row.title),
				checks: allChecks.filter((c) => c.eventId === row.id),
				duplicateOf: dupe ? { title: dupe.title, path: eventPath(dupe.id, dupe.title) } : null
			};
		});
	}
);

export type QueuedSubmission = Awaited<ReturnType<typeof mySubmissions>>[number];

/**
 * One submission, in the shape the form holds it, so a revision opens filled in.
 *
 * `/send-inn?rett=<id>` used to open an empty form: the id travelled, so the server knew which row
 * to replace, but nobody had told the *fields* anything — which meant revising a submission because
 * one date was wrong required retyping all ten of the others. That made the whole refinement loop
 * something people would abandon rather than use.
 *
 * Scoped to this browser and to rows that are not published, exactly as the revision itself is: the
 * form must never become a way to read back somebody else's draft.
 */
export const submissionDraft = query(
	z.object({
		id: z.number().int().positive(),
		clientId: z
			.string()
			.trim()
			.min(8)
			.max(64)
			.regex(/^[A-Za-z0-9-]+$/, 'client id must be opaque')
	}),
	async ({ id, clientId }) => {
		const database = db();
		const [row] = await database
			.select({
				id: events.id,
				title: events.title,
				description: events.description,
				category: events.category,
				startsAt: events.startsAt,
				endsAt: events.endsAt,
				sourceUrl: events.sourceUrl,
				ctaUrl: events.ctaUrl,
				method: events.submissionMethod,
				seriesId: events.seriesId,
				venueName: venues.name,
				venueMunicipality: venues.municipality,
				venueTimeZone: venues.timezone,
				organizerName: organizers.name
			})
			.from(events)
			.leftJoin(venues, eq(events.venueId, venues.id))
			.leftJoin(organizers, eq(events.organizerId, organizers.id))
			.where(
				and(
					eq(events.id, id),
					eq(events.submitterClientId, clientId),
					// Never a published event: revising is a route onto the site, not a way to edit it.
					ne(events.status, 'published'),
					// Still inside its window; an expired row is gone as far as /kø is concerned.
					gte(events.updatedAt, submissionCutoff())
				)
			)
			.limit(1);

		if (!row) return null;

		/*
		 * The instant back to the wall clock somebody typed.
		 *
		 * In the venue's zone, never the server's — a 20:00 concert read back in UTC puts 18:00 in
		 * the box, and the person "corrects" a time that was right.
		 */
		const zone = row.venueTimeZone ?? 'Europe/Oslo';
		const start = instantToZonedWallClock(row.startsAt, zone);
		const end = row.endsAt ? instantToZonedWallClock(row.endsAt, zone) : null;

		/*
		 * A recurring submission's rule is reconstructed from the series, not from the row.
		 *
		 * The occurrences are ordinary events and carry no rule of their own; the series is where
		 * "every Thursday until June" actually lives. Without this a weekly submission would come
		 * back as a single date and quietly lose its repetition on the next send.
		 */
		let recurrence: {
			// Typed from core's list, not written out: a new frequency must not need a second edit
			// here to reach the form (CLAUDE.md rule 1).
			repeats: (typeof RECURRENCE_FREQUENCIES)[number];
			repeatWeekdays: string[];
			repeatNth: string;
			repeatUntil: string;
		} | null = null;

		if (row.seriesId !== null) {
			const [series] = await database
				.select({
					freq: eventSeries.freq,
					weekdays: eventSeries.weekdays,
					nth: eventSeries.nth,
					until: eventSeries.until
				})
				.from(eventSeries)
				.where(eq(eventSeries.id, row.seriesId))
				.limit(1);
			if (series) {
				recurrence = {
					repeats: series.freq,
					repeatWeekdays: series.weekdays.map(String),
					repeatNth: series.nth === null ? '' : String(series.nth),
					repeatUntil: series.until ?? ''
				};
			}
		}

		/*
		 * Annotated, not inferred.
		 *
		 * Inside an object literal TypeScript widens `'nei'` to `string`, and the form's field is a
		 * union — so the value arrives at `f.set` as the wrong type with no cast available to us
		 * (CLAUDE.md rule 4). A named const with a declared type keeps the literal union intact.
		 */
		const repeats: (typeof RECURRENCE_FREQUENCIES)[number] | 'nei' = recurrence?.repeats ?? 'nei';

		return {
			id: row.id,
			title: row.title,
			description: row.description ?? '',
			category: row.category,
			date: start.date,
			startTime: start.time,
			endTime: end?.time ?? '',
			venueName: row.venueName ?? '',
			municipality: row.venueMunicipality ?? '',
			organizerName: row.organizerName ?? '',
			sourceUrl: row.sourceUrl ?? '',
			ctaUrl: row.ctaUrl ?? '',
			method: row.method,
			timeZone: zone,
			repeats,
			repeatWeekdays: recurrence?.repeatWeekdays ?? [],
			repeatNth: recurrence?.repeatNth ?? '',
			repeatUntil: recurrence?.repeatUntil ?? ''
		};
	}
);

export type SubmissionDraft = NonNullable<Awaited<ReturnType<typeof submissionDraft>>>;

/** Is the photo shortcut available? The UI hides it rather than offering a broken button. */
export const submissionCapabilities = query(async () => ({ photo: verifierEnabled() }));

const photoSchema = z.object({
	/** Base64 without the data: prefix. The browser downscales before sending. */
	imageBase64: z.string().min(100).max(8_000_000),
	mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
	/** The photographer's local date, so "laurdag 14." resolves to the right year. */
	today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

/**
 * Read a photographed poster into a draft. The result pre-fills the form — it is never submitted
 * on the person's behalf. That review step is what makes reading a poster with a model safe.
 */
export const extractFromPhoto = command(photoSchema, async ({ imageBase64, mediaType, today }) => {
	if (!verifierEnabled()) {
		return { ok: false as const, error: 'Bilettolking er ikkje slått på her.' };
	}
	try {
		const draft = await extractPoster(imageBase64, mediaType, today);
		return { ok: true as const, draft };
	} catch (error) {
		// A failed extraction is not a failed submission — the person types it in instead.
		return {
			ok: false as const,
			error:
				error instanceof Error && error.name === 'TimeoutError'
					? 'Tolkinga tok for lang tid. Fyll inn skjemaet under.'
					: 'Kunne ikkje lese plakaten. Fyll inn skjemaet under.'
		};
	}
});

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/æ/g, 'ae')
		.replace(/ø/g, 'oe')
		.replace(/å/g, 'aa')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 120);
}

/** The local date `weeks` ahead of `from`, as YYYY-MM-DD. Pure date arithmetic, no timezone. */
function localDatePlusWeeks(from: string, weeks: number): string {
	const [y, m, d] = from.split('-').map(Number);
	const stamp = Date.UTC(y!, m! - 1, d!) + weeks * 7 * 86_400_000;
	return new Date(stamp).toISOString().slice(0, 10);
}

function toRecurrence(submission: {
	repeats: string;
	repeatWeekdays?: string[];
	repeatNth?: string;
	repeatUntil?: string;
}): Recurrence | null {
	if (submission.repeats === 'nei') return null;
	return {
		freq: submission.repeats as Recurrence['freq'],
		interval: 1,
		weekdays: (submission.repeatWeekdays ?? []).map(Number) as Weekday[],
		nth: submission.repeatNth ? Number(submission.repeatNth) : null,
		until: submission.repeatUntil ?? null
	};
}

export const submitEvent = form(eventFormSchema, async (submission) => {
	const database = db();
	// A poster gives a wall clock, not an instant. Resolve it in the venue's zone, not the
	// server's — otherwise every deployment outside Norway stores the wrong time.
	const startsAt = zonedWallClockToInstant(
		submission.date,
		submission.startTime,
		submission.timeZone
	);
	const endsAt = submission.endTime
		? zonedWallClockToInstant(submission.date, submission.endTime, submission.timeZone)
		: null;

	// Shortlist possible duplicates in SQL — the database is better at searching than a model is,
	// and it keeps the model's job to the part that needs judgement.
	const dayBefore = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);
	const dayAfter = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
	const candidates = await database
		.select({
			id: events.id,
			sourceId: events.sourceId,
			title: events.title,
			startsAt: events.startsAt,
			venueName: venues.name
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(
			and(
				gte(events.startsAt, dayBefore),
				lte(events.startsAt, dayAfter),
				/*
				 * Only what is actually on the site.
				 *
				 * Without this, a submission we rejected an hour ago counts as an event we "already
				 * have" — so the second attempt is told it is a duplicate of something invisible,
				 * and resubmitting a corrected version becomes impossible. It also made the e2e
				 * suite order-dependent, since each run found the previous run's row.
				 */
				eq(events.status, 'published'),
				// And never a duplicate of a duplicate: point at the row we would actually show.
				isNull(events.duplicateOfId)
			)
		)
		.limit(25);

	/*
	 * The duplicate decision is made here, not taken from the browser.
	 *
	 * `findDuplicate` runs the same comparison before the form so nobody wastes their time, but its
	 * answer is a courtesy to the reader and not evidence. Anything that decides whether a row is
	 * published has to be computed on the server from the values actually being stored.
	 *
	 * Same `comparePair` as `pnpm consolidate`, so a duplicate means one thing across the whole
	 * system rather than one thing on submission and another on import.
	 */
	const probe = {
		id: -1,
		sourceId: null,
		title: submission.title,
		startsAt,
		venueName: submission.venueName
	};
	let duplicateOfId: number | null = null;
	let duplicateScore = 0;
	for (const candidate of candidates) {
		const pair = comparePair(probe, candidate);
		if (pair.same && pair.score > duplicateScore) {
			duplicateOfId = candidate.id;
			duplicateScore = pair.score;
		}
	}

	const verdict = await verifyEvent({
		title: submission.title,
		description: submission.description,
		category: submission.category,
		startsAt: startsAt.toISOString(),
		endsAt: endsAt?.toISOString() ?? null,
		venueName: submission.venueName,
		municipality: submission.municipality,
		organizerName: submission.organizerName,
		sourceUrl: submission.sourceUrl,
		candidates: candidates.map((c) => ({
			id: c.id,
			title: c.title,
			startsAt: c.startsAt.toISOString(),
			venueName: c.venueName
		}))
	});

	const venueSlug = slugify(submission.venueName);
	const [venue] = await database
		.insert(venues)
		.values({
			name: submission.venueName,
			slug: venueSlug,
			municipality: submission.municipality,
			geocodeStatus: 'pending'
		})
		.onConflictDoUpdate({
			target: venues.slug,
			set: submission.municipality
				? { municipality: submission.municipality }
				: { name: submission.venueName }
		})
		.returning({ id: venues.id });

	let organizerId: number | undefined;
	if (submission.organizerName) {
		const [organizer] = await database
			.insert(organizers)
			.values({ name: submission.organizerName, slug: slugify(submission.organizerName) })
			.onConflictDoUpdate({ target: organizers.slug, set: { name: submission.organizerName } })
			.returning({ id: organizers.id });
		organizerId = organizer?.id;
	}

	/*
	 * The decision, made here and now. Nothing waits for a person.
	 *
	 * `review` used to mean a queue, and a queue with nobody in it is just a slower rejection that
	 * nobody is told about. Every submission now leaves with one of four answers, and the reader is
	 * told which — because "no" for spam, "no" because we already have it, and "no" because the
	 * date is unreadable are three different messages and only one of them deserves an apology.
	 *
	 * A rejected submission is still stored. Deleting it would mean the same spam can be
	 * resubmitted forever with nothing to compare against.
	 */
	const duplicateCheck = verdict.checks.find((check) => check.check === 'duplicate');
	const plausibility = verdict.checks.find((check) => check.check === 'plausibility');

	const outcome: 'approved' | 'duplicate' | 'shady' | 'declined' =
		duplicateOfId !== null || duplicateCheck?.verdict === 'fail'
			? 'duplicate'
			: plausibility?.verdict === 'fail'
				? /*
					 * Only plausibility earns `shady`.
					 *
					 * It is the check that asks whether this is spam or nonsense, and it is the only
					 * outcome we do not apologise for. Letting any failed check land here would call
					 * somebody a spammer for mistyping a postcode.
					 */
					('shady' as const)
				: verdict.recommendation === 'publish'
					? ('approved' as const)
					: ('declined' as const);

	const status = outcome === 'approved' ? ('published' as const) : ('rejected' as const);

	/*
	 * A repeating submission becomes a series plus one row per occurrence inside the horizon.
	 *
	 * The occurrences are ordinary events, so every listing, the day grouping, deduplication and
	 * the iCal feed keep working untouched. The alternative — one row plus expansion at query time
	 * — would mean rewriting every listing query. See docs/decisions/0009-recurring-events.md.
	 */
	const recurrence = toRecurrence(submission);
	let seriesId: number | undefined;
	let occurrences = [{ startsAt, endsAt }];

	/*
	 * A poster that lists its evenings one by one, rather than stating a rule.
	 *
	 * "torsdagar: 27.aug. 24.sept. 29.okt. og 26.nov" is four events. It is not a recurrence —
	 * nothing about four Thursdays scattered across a term follows a pattern `expandRecurrence`
	 * could produce — and taking only the first gave one event on a date that had usually already
	 * passed, which is what was actually happening.
	 *
	 * Each date keeps the same wall-clock time and is resolved in the venue's zone independently,
	 * so a series that crosses the October change stays at 18:00 on both sides of it rather than
	 * drifting to 17:00.
	 */
	if (!recurrence && submission.extraDates.length > 0) {
		const days = [...new Set([submission.date, ...submission.extraDates])].sort();
		occurrences = days.map((day) => ({
			startsAt: zonedWallClockToInstant(day, submission.startTime, submission.timeZone),
			endsAt: submission.endTime
				? zonedWallClockToInstant(day, submission.endTime, submission.timeZone)
				: null
		}));
	}

	if (recurrence) {
		const horizonEnd = localDatePlusWeeks(submission.date, HORIZON_WEEKS);
		const expanded = expandRecurrence({
			recurrence,
			anchorDate: submission.date,
			startTime: submission.startTime,
			endTime: submission.endTime ?? null,
			timeZone: submission.timeZone,
			from: submission.date,
			to: horizonEnd
		});

		// A rule that matches nothing is a rule the person got wrong, not an empty series to store.
		if (expanded.length === 0) {
			return {
				status: 'rejected' as const,
				/*
				 * `declined`, not `shady`. Nobody was trying anything — they picked a weekday the
				 * first date does not fall on, and the fix is one field away. Saying so is the whole
				 * value of having four outcomes instead of "no".
				 */
				outcome: 'declined' as const,
				revisedFrom: null,
				eventId: null,
				duplicateOf: null,
				recommendation: 'review' as const,
				summary: 'Gjentakinga traff ingen datoar. Sjekk vekedag og første dato, og prøv igjen.',
				checks: verdict.checks
			};
		}

		const [series] = await database
			.insert(eventSeries)
			.values({
				freq: recurrence.freq,
				interval: recurrence.interval,
				weekdays: recurrence.weekdays,
				nth: recurrence.nth,
				anchorDate: submission.date,
				until: recurrence.until,
				startTime: submission.startTime,
				endTime: submission.endTime ?? null,
				timezone: submission.timeZone,
				materialisedThrough: horizonEnd
			})
			.returning({ id: eventSeries.id });
		seriesId = series?.id;
		occurrences = expanded.map((o) => ({ startsAt: o.startsAt, endsAt: o.endsAt }));
	}

	/*
	 * A revision replaces the row it revises; it does not add another.
	 *
	 * Without this, each attempt at getting a submission past the checks leaves a near-identical
	 * draft behind — and the second attempt is flagged as a duplicate of the first, which is
	 * exactly the loop `/ko` exists to break. Ownership is checked before anything is touched: a
	 * revision only applies to a row this browser sent in, and only while it is unpublished.
	 */
	let revising: number | null = null;
	if (submission.revisionOf && submission.clientId) {
		const [owned] = await database
			.select({ id: events.id, seriesId: events.seriesId })
			.from(events)
			.where(
				and(
					eq(events.id, Number(submission.revisionOf)),
					eq(events.submitterClientId, submission.clientId),
					/*
					 * Never a published event.
					 *
					 * Once something is out, editing it through this path would be a way to change
					 * a live listing with nothing but a browser-local id — which is a bearer token,
					 * not a credential. Revision is for getting a rejected submission over the line.
					 */
					ne(events.status, 'published')
				)
			)
			.limit(1);
		if (owned) {
			revising = owned.id;
			// Its old occurrences go with it, or a weekly submission revised to a single date
			// leaves the other twenty-nine sitting there.
			if (owned.seriesId !== null) {
				await database.delete(events).where(eq(events.seriesId, owned.seriesId));
			} else {
				await database.delete(events).where(eq(events.id, owned.id));
			}
		}
	}

	const inserted = await database
		.insert(events)
		.values(
			occurrences.map((occurrence) => ({
				title: submission.title,
				description: submission.description,
				category: submission.category,
				startsAt: occurrence.startsAt,
				endsAt: occurrence.endsAt,
				venueId: venue?.id,
				organizerId,
				seriesId,
				sourceUrl: submission.sourceUrl,
				ctaUrl: submission.ctaUrl,
				status,
				submissionMethod: submission.method,
				submissionOutcome: outcome,
				submitterClientId: submission.clientId ?? null,
				/*
				 * Point at what it duplicates, using the column consolidation already uses.
				 *
				 * That makes the submission behave exactly like an imported duplicate: hidden from
				 * every listing, and named on the canonical event's page as another report of the
				 * same thing. It is not thrown away, and it is not shown twice.
				 */
				duplicateOfId: outcome === 'duplicate' ? duplicateOfId : null,
				verificationNotes: verdict.summary
			}))
		)
		.returning({ id: events.id });
	const created = inserted[0];

	if (created) {
		// Store every check, including the ones that passed. The README promises the reasoning is
		// auditable; a verdict with no record of why is the black box we said we would not build.
		await database.insert(verifications).values(
			verdict.checks.map((check) => ({
				eventId: created.id,
				check: check.check,
				verdict: check.verdict,
				confidence: check.confidence,
				reasoning: check.reasoning,
				model: check.model,
				deterministic: check.deterministic
			}))
		);
	}

	/*
	 * The event we think this duplicates, resolved for the panel.
	 *
	 * Sent back with the verdict so the reader can see the thing we already had rather than being
	 * told, flatly, that theirs was a copy of something unnamed.
	 */
	let duplicateOf: {
		title: string;
		path: string;
		startsAt: Date;
		venueName: string | null;
		venueTimeZone: string | null;
	} | null = null;
	if (outcome === 'duplicate' && duplicateOfId !== null) {
		const [existing] = await database
			.select({
				id: events.id,
				title: events.title,
				startsAt: events.startsAt,
				venueName: venues.name,
				venueTimeZone: venues.timezone
			})
			.from(events)
			.leftJoin(venues, eq(events.venueId, venues.id))
			.where(eq(events.id, duplicateOfId))
			.limit(1);
		if (existing) {
			duplicateOf = {
				title: existing.title,
				path: eventPath(existing.id, existing.title),
				startsAt: existing.startsAt,
				venueName: existing.venueName,
				venueTimeZone: existing.venueTimeZone
			};
		}
	}

	return {
		status,
		outcome,
		/** The submission this replaced, when it was a revision. Null for a first attempt. */
		revisedFrom: revising,
		eventId: created?.id ?? null,
		/* Echoed back so the verdict can link it: the sender needs to see the URL we judged. */
		sourceUrl: submission.sourceUrl ?? null,
		duplicateOf,
		recommendation: verdict.recommendation,
		summary: recurrence
			? `${verdict.summary} Lagra som ${describeRecurrence(recurrence)} — ${inserted.length} datoar dei neste ${HORIZON_WEEKS} vekene.`
			: verdict.summary,
		checks: verdict.checks
	};
});
