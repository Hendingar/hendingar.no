import type { ExtractedEvent } from '@hendingar/core/validation';

/**
 * Which form fields a photo actually filled in.
 *
 * The form has always said what the model could NOT read. It never said what it DID — so a value
 * lifted off a poster and a value someone typed looked identical, which is the difference between
 * checking a suggestion and re-entering it from scratch.
 *
 * Pure and separate from the component so the mapping can be tested: extraction needs the verifier
 * service, which CI does not run, and the field-name mismatch below is exactly the kind of thing a
 * test catches and a screenshot does not.
 */

/**
 * Draft key → form field id.
 *
 * Mostly identity, and `ticketUrl` is not: the extraction calls it `ticketUrl` while the form field
 * is `ctaUrl`. Keying provenance on the draft name would point a badge at an input that does not
 * exist, and the badge would simply never appear — a silent failure with no error anywhere.
 */
const FIELD_BY_DRAFT_KEY = {
	title: 'title',
	description: 'description',
	category: 'category',
	date: 'date',
	startTime: 'startTime',
	endTime: 'endTime',
	venueName: 'venueName',
	municipality: 'municipality',
	organizerName: 'organizerName',
	ticketUrl: 'ctaUrl'
} as const satisfies Partial<Record<keyof ExtractedEvent, string>>;

export const PROVENANCE_FIELDS: readonly string[] = Object.values(FIELD_BY_DRAFT_KEY);

/**
 * A field counts as read from the image when the draft carries a value for it.
 *
 * `null` from the model means "I could not tell", not "this is empty" — which is why the check is
 * for a present, non-empty value rather than for the key existing.
 */
export function photoFilledFields(draft: ExtractedEvent): string[] {
	const filled: string[] = [];
	for (const [draftKey, field] of Object.entries(FIELD_BY_DRAFT_KEY)) {
		const value = (draft as Record<string, unknown>)[draftKey];
		if (value === null || value === undefined) continue;
		if (typeof value === 'string' && value.trim() === '') continue;
		filled.push(field);
	}
	return filled;
}
