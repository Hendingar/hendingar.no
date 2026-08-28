import { command, form, query } from '$app/server';
import { z } from 'zod';
import { and, eq, gte, lte } from 'drizzle-orm';
import { events, organizers, venues, verifications } from '@hendingar/core/schema';
import { eventFormSchema } from '@hendingar/core/validation';
import { zonedWallClockToInstant } from '@hendingar/core/datetime';
import { db } from './server/db';
import { extractPoster, verifierEnabled, verifyEvent } from './server/verifier';

/**
 * Event submission — the form, the photo shortcut, and the verification that gates both.
 *
 * A submitted event is never published on the model's say-so alone. It is stored, every check
 * records its reasoning in `verifications`, and only a unanimous confident pass publishes
 * directly. Everything else waits for a person. See services/verifier/README.md.
 */

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
			title: events.title,
			startsAt: events.startsAt,
			venueName: venues.name
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(and(gte(events.startsAt, dayBefore), lte(events.startsAt, dayAfter)))
		.limit(25);

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
	 * A rejected submission is still stored, as `rejected`. Deleting it would mean the same spam
	 * can be resubmitted forever with nothing to compare against, and a wrongly-rejected event
	 * could never be recovered by a human.
	 */
	const status =
		verdict.recommendation === 'publish'
			? ('published' as const)
			: verdict.recommendation === 'reject'
				? ('rejected' as const)
				: ('pending' as const);

	const [created] = await database
		.insert(events)
		.values({
			title: submission.title,
			description: submission.description,
			category: submission.category,
			startsAt,
			endsAt,
			venueId: venue?.id,
			organizerId,
			sourceUrl: submission.sourceUrl,
			ctaUrl: submission.ctaUrl,
			status,
			submissionMethod: submission.method,
			verificationNotes: verdict.summary
		})
		.returning({ id: events.id });

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

	return {
		status,
		recommendation: verdict.recommendation,
		summary: verdict.summary,
		checks: verdict.checks
	};
});
