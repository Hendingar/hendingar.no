import type { UpcomingEvent } from './events.remote';

/**
 * Collapse repeats of the same event on the same day into one card.
 *
 * Public swimming runs at 12:00, 17:00, 18:00 and 18:59; a språkkafé runs twice. Those are four
 * genuinely different sessions — you attend one of them — so consolidation deliberately does NOT
 * merge them, and it is right not to: they are separate rows with separate pages.
 *
 * But four identical posters stacked down the page spend a screenful saying one thing. This is a
 * *presentation* grouping and nothing more: every occurrence keeps its own row, its own id and its
 * own URL, and the card lists the times as links.
 *
 * Pure and separate from the component so the rule can be tested without rendering anything.
 */
export type Occurrence = { id: number; startsAt: Date; venueTimeZone: string | null };

export type StackedEvent = {
	/** The first occurrence, which supplies the poster, title, venue and category. */
	lead: UpcomingEvent;
	/**
	 * Every occurrence including the lead, in time order.
	 *
	 * Always populated — a single-showing event has one — so a caller never needs to decide whether
	 * to read this or `lead`.
	 */
	occurrences: Occurrence[];
};

/**
 * What makes two rows "the same thing again".
 *
 * Title and venue, both normalised for case and spacing. Deliberately NOT the source: if two
 * sources list the same session and consolidation has already merged them, only one row is here;
 * if it has not, they are two rows the reader should see separately rather than have silently
 * folded together by a display rule.
 *
 * The category is not part of the key either. Two sources can disagree about whether a talk is
 * `mote` or `litteratur`, and that disagreement should not split a card.
 */
function stackKey(event: UpcomingEvent): string {
	const title = event.title.trim().toLowerCase().replace(/\s+/g, ' ');
	const venue = (event.venueName ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
	return `${title}@@${venue}`;
}

/**
 * Group a single day's events. Order is preserved: a stack appears where its first occurrence was,
 * so the day still reads chronologically.
 */
export function stackOccurrences(events: readonly UpcomingEvent[]): StackedEvent[] {
	const stacks: StackedEvent[] = [];
	const byKey = new Map<string, StackedEvent>();

	for (const event of events) {
		const key = stackKey(event);
		const existing = byKey.get(key);
		const occurrence: Occurrence = {
			id: event.id,
			startsAt: event.startsAt,
			venueTimeZone: event.venueTimeZone
		};

		if (existing) {
			existing.occurrences.push(occurrence);
			continue;
		}

		const stack: StackedEvent = { lead: event, occurrences: [occurrence] };
		byKey.set(key, stack);
		stacks.push(stack);
	}

	for (const stack of stacks) {
		stack.occurrences.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
	}

	return stacks;
}
