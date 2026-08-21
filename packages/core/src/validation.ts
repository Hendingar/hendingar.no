import { z } from 'zod';
import { CATEGORY_SLUGS } from './taxonomy.ts';

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
	municipality: z.string().trim().max(100).optional(),
	limit: z.number().int().min(1).max(100).default(50)
});

export type EventQuery = z.infer<typeof eventQuerySchema>;
