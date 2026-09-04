import { z } from 'zod';
import { CATEGORY_SLUGS } from './taxonomy.ts';
import { VERIFICATION_VERDICTS } from './verification.ts';
import { RECURRENCE_FREQUENCIES, WEEKDAYS } from './recurrence.ts';

/**
 * Validation lives here so ONE schema serves every boundary: remote-function arguments, importer
 * output, and database writes. A second definition of "what an event is" is how the app and the
 * importers quietly disagree.
 */

export const categorySchema = z.enum(CATEGORY_SLUGS);

/** An ISO 8601 timestamp that keeps its offset. Importers must not flatten this to UTC. */
const isoWithOffset = z
	.string()
	.regex(
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
		'must be ISO 8601 with an explicit offset'
	);

/** What a human submits. Deliberately small — anyone can add an event, no account needed. */
export const eventSubmissionSchema = z
	.object({
		title: z.string().trim().min(3).max(200),
		description: z.string().trim().max(5000).optional(),
		category: categorySchema,
		startsAt: isoWithOffset,
		endsAt: isoWithOffset.optional(),
		venueName: z.string().trim().min(2).max(200),
		municipality: z.string().trim().max(100).optional(),
		organizerName: z.string().trim().max(200).optional(),
		ctaUrl: z.url().max(2000).optional(),
		sourceUrl: z.url().max(2000).optional()
	})
	.refine((v) => !v.endsAt || Date.parse(v.endsAt) > Date.parse(v.startsAt), {
		message: 'endsAt must be after startsAt',
		path: ['endsAt']
	});

export type EventSubmission = z.infer<typeof eventSubmissionSchema>;

/**
 * The normalised shape every importer must produce, whatever the source looks like. An importer
 * whose output fails this schema fails loudly at import time instead of writing rubbish.
 */
export const importedEventSchema = eventSubmissionSchema.safeExtend({
	externalId: z.string().min(1),
	posterUrl: z.url().optional(),
	posterRightsVerified: z.boolean().default(false)
});

export type ImportedEvent = z.infer<typeof importedEventSchema>;

/** Query args for the public listing. */
export const eventQuerySchema = z.object({
	from: isoWithOffset.optional(),
	to: isoWithOffset.optional(),
	category: categorySchema.optional(),
	/**
	 * A source slug, so a reader can ask for one calendar's events.
	 *
	 * Not validated against a list of known slugs: sources are rows, not a compile-time set, and a
	 * slug that matches nothing must return an empty list rather than an error — the same treatment
	 * a hand-edited `?kategori=` gets. The shape is constrained to what a slug can be so this
	 * cannot become a way to smuggle anything into the query.
	 */
	source: z
		.string()
		.trim()
		.max(100)
		.regex(/^[a-z0-9-]+$/, 'must be a source slug')
		.optional(),
	municipality: z.string().trim().max(100).optional(),
	limit: z.number().int().min(1).max(100).default(50),
	/**
	 * How many rows to skip, for paging a long listing.
	 *
	 * Offset rather than a cursor, deliberately. The listing is ordered by
	 * `greatest(starts_at, now())` so that an event already under way sorts under today rather than
	 * under the day it began — a computed key, which a cursor would have to reproduce exactly in
	 * two places to stay correct. An offset re-reads a slightly different window if the data shifts
	 * between requests, and for a calendar that changes once a day that is a far smaller problem
	 * than a cursor quietly disagreeing with the sort.
	 */
	offset: z.number().int().min(0).max(5000).default(0)
});

export type EventQuery = z.infer<typeof eventQuerySchema>;

/**
 * What the vision model is asked to return when reading a poster.
 *
 * Deliberately permissive where a poster is: every field except the title is nullable, because a
 * poster that omits the end time or the organiser is normal, and a model that invents one is worse
 * than a blank field a human fills in. `confidence` and `unreadable` exist so the UI can show what
 * the extraction is unsure about instead of presenting guesses as facts.
 */
/**
 * A repetition stated on the image instead of a date.
 *
 * This exists because leaving it out caused hallucination rather than only losing information:
 * with nowhere to record "every Thursday", the model wrote a concrete date — and chose the wrong
 * weekday. Measured in services/verifier/evals/cases/komle-vertshuset.
 */
export const extractedRecurrenceSchema = z.object({
	freq: z.enum(RECURRENCE_FREQUENCIES),
	interval: z.number().int().min(1).max(52).default(1),
	weekdays: z.array(z.literal(WEEKDAYS)).default([]),
	nth: z.number().int().min(-1).max(5).nullable().default(null),
	until: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
		.nullable()
		.default(null)
});

export type ExtractedRecurrence = z.infer<typeof extractedRecurrenceSchema>;

export const extractedEventSchema = z.object({
	title: z.string().nullable(),
	description: z.string().nullable(),
	category: categorySchema.nullable(),
	/** Local date at the venue, YYYY-MM-DD. Not an instant — a poster has no timezone. */
	date: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
		.nullable(),
	/** Local wall-clock time, HH:MM. */
	startTime: z
		.string()
		.regex(/^\d{2}:\d{2}$/, 'must be HH:MM')
		.nullable(),
	endTime: z
		.string()
		.regex(/^\d{2}:\d{2}$/, 'must be HH:MM')
		.nullable(),
	/** Set instead of `date` when the image states a repetition. */
	recurrence: extractedRecurrenceSchema.nullable().default(null),
	venueName: z.string().nullable(),
	municipality: z.string().nullable(),
	organizerName: z.string().nullable(),
	ticketUrl: z.string().nullable(),
	/** 0–100, the model's own confidence that this is a real event poster it read correctly. */
	confidence: z.number().int().min(0).max(100),
	/** Fields the model could not read, so the form can highlight them for the human. */
	unreadable: z.array(z.string()),
	/** One sentence for the person, in Nynorsk, about what was read and what was not. */
	note: z.string(),
	/**
	 * Where the interesting part of the poster is, as fractions of the image.
	 *
	 * Used to crop a card thumbnail in the browser. Nullable and never trusted blindly: the client
	 * checks the box is sane before applying it, because a bad crop is worse than none. See
	 * `app/src/lib/poster.ts`.
	 */
	thumbnail: z
		.object({
			x: z.number(),
			y: z.number(),
			width: z.number(),
			height: z.number()
		})
		.nullable()
		.optional()
});

export type ExtractedEvent = z.infer<typeof extractedEventSchema>;

/** The verification pipeline's per-check output. */
export const verificationResultSchema = z.object({
	verdict: z.enum(VERIFICATION_VERDICTS),
	confidence: z.number().int().min(0).max(100),
	/** Stated in Nynorsk — this is shown to people, not just logged. */
	reasoning: z.string().min(1)
});

export type VerificationResult = z.infer<typeof verificationResultSchema>;

/**
 * What the submission form posts.
 *
 * Date and time are separate fields rather than an ISO instant, because that is what a person
 * reads off a poster and what a plain HTML form can send. The instant is derived server-side with
 * the venue's zone (see `zonedWallClockToInstant`), so the form needs no JavaScript to be correct.
 */
export const eventFormSchema = z
	.object({
		title: z.string().trim().min(3).max(200),
		description: z.string().trim().max(5000).optional(),
		category: categorySchema,
		date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dato må vere ÅÅÅÅ-MM-DD'),
		startTime: z.string().regex(/^\d{2}:\d{2}$/, 'klokkeslett må vere TT:MM'),
		endTime: z
			.string()
			.regex(/^\d{2}:\d{2}$/, 'klokkeslett må vere TT:MM')
			.optional()
			.or(z.literal('').transform(() => undefined)),
		venueName: z.string().trim().min(2).max(200),
		municipality: z.string().trim().max(100).optional(),
		organizerName: z.string().trim().max(200).optional(),
		ctaUrl: z
			.url()
			.max(2000)
			.optional()
			.or(z.literal('').transform(() => undefined)),
		sourceUrl: z
			.url()
			.max(2000)
			.optional()
			.or(z.literal('').transform(() => undefined)),
		/**
		 * Does it repeat, and how.
		 *
		 * A select rather than a checkbox plus a frequency: remote form schemas require every
		 * boolean to be optional (an unchecked box sends nothing), and "nei" as an explicit value
		 * avoids the whole question. `date` remains the FIRST occurrence either way.
		 */
		repeats: z.enum(['nei', ...RECURRENCE_FREQUENCIES]).default('nei'),
		/** ISO weekdays as strings, because that is what checkbox inputs post. */
		repeatWeekdays: z
			.array(z.enum(WEEKDAYS.map(String) as [string, ...string[]]))
			.optional()
			.default([]),
		/** Monthly only: which occurrence of the weekday, or -1 for the last. */
		repeatNth: z
			.enum(['1', '2', '3', '4', '5', '-1'])
			.optional()
			.or(z.literal('').transform(() => undefined)),
		repeatUntil: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, 'dato må vere ÅÅÅÅ-MM-DD')
			.optional()
			.or(z.literal('').transform(() => undefined)),
		/** Provenance, so /datasamling can report how events actually arrive. */
		method: z.enum(['form', 'photo']).default('form'),
		/**
		 * The browser sending this, so it can find the submission again in `/ko` and revise it.
		 *
		 * Optional: a submission without one still goes through, it simply cannot be revised later.
		 * Never trusted for anything but "show me my own" — see the column comment in schema.ts.
		 */
		clientId: z
			.string()
			.trim()
			.max(64)
			.regex(/^[A-Za-z0-9-]*$/, 'client id må vere ugjennomsiktig')
			.optional()
			.or(z.literal('').transform(() => undefined)),
		/**
		 * Set when this is a revision of a submission that did not pass.
		 *
		 * The row is updated rather than replaced: a new row each time would fill the database with
		 * near-identical drafts, and the second attempt would be flagged as a duplicate of the
		 * first — which is the exact loop `/ko` exists to break.
		 */
		revisionOf: z
			.string()
			.regex(/^\d+$/, 'må vere ein id')
			.optional()
			.or(z.literal('').transform(() => undefined)),
		/** IANA zone the wall-clock time is in. Defaults to the pilot region. */
		timeZone: z.string().default('Europe/Oslo')
	})
	.refine((v) => !v.endTime || v.endTime > v.startTime, {
		message: 'sluttid må vere etter starttid',
		path: ['endTime']
	})
	.refine((v) => v.repeats !== 'weekly' || (v.repeatWeekdays?.length ?? 0) > 0, {
		message: 'vel minst éin vekedag',
		path: ['repeatWeekdays']
	})
	.refine((v) => v.repeats !== 'monthly' || (v.repeatWeekdays?.length ?? 0) > 0, {
		message: 'vel vekedagen det gjeld',
		path: ['repeatWeekdays']
	})
	.refine((v) => !v.repeatUntil || v.repeatUntil >= v.date, {
		message: 'sluttdato må vere etter første dato',
		path: ['repeatUntil']
	});

export type EventForm = z.infer<typeof eventFormSchema>;
