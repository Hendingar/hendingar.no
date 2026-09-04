import type { CategorySlug } from '@hendingar/core/taxonomy';
import type { RawEvent, UpstreamDetail } from './api.ts';
import type { BakhagenInstance } from './instances.ts';

/**
 * Pure mapping: a Bakhagen activity card → our shape. No I/O, no clock, no randomness.
 */

/**
 * A hagelag evening is a meeting unless the title says otherwise.
 *
 * The opposite default from `importers/mec`, and for the same reason `importers/kyrkja` defaults
 * to `kyrkjeliv`: this is one association's own programme, so "members gathering for a talk, a
 * plant swap or an annual meeting" is a fact about the source rather than a guess about the
 * event. Bømlo's own back catalogue is årsmøte, temakveld, medlemskveld, hagevandring, foredrag
 * and frøpakking — every one of them a `mote`. Filing those under `anna` would be less accurate,
 * not more cautious.
 */
export const DEFAULT_CATEGORY: CategorySlug = 'mote';

/**
 * The two words the title states unambiguously, and nothing else.
 *
 * The title is the only categorisation signal a Bakhagen card carries — there is no taxonomy, no
 * label, no tag. So the rules stay where the word means one thing: a `kurs` is a course, and a
 * `planteloppemarknad` is a market. "Foredrag", "temakveld" and "hagevandring" are deliberately
 * *not* rules; they all land on the default anyway, and inventing finer distinctions from free
 * text is exactly the guessing ADR 0004 keeps out of the import path. Anything more nuanced is
 * the verification service's job, on structured data, with a human for the uncertain cases.
 *
 * Matched on whole words or compound ends rather than substrings, because Norwegian compounds
 * carry the meaning in the last morpheme: `fermenteringskurs` is a course, `ekskursjon` is not.
 */
const CATEGORY_WORDS: ReadonlyArray<{ stems: readonly string[]; category: CategorySlug }> = [
	{ stems: ['kurs'], category: 'kurs' },
	{ stems: ['marknad', 'marked', 'basar'], category: 'marknad' }
];

/** Lowercased words of a title, split on anything that is not a letter or a digit. */
function words(title: string): string[] {
	return title
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

/**
 * True when `word` is the stem, or a compound that opens or closes with it.
 *
 * `fermenteringskurs` and `kurskveld` are courses; `ekskursjon` is not, because `kurs` sits in the
 * middle of it. `diskurs` would match, and is left matching: a hagelag will not run one, and if it
 * somehow does, "kurs" is not a bad answer.
 */
function carriesStem(word: string, stem: string): boolean {
	return word === stem || word.startsWith(stem) || word.endsWith(stem);
}

export function mapCategory(title: string): CategorySlug {
	const parts = words(title);
	for (const rule of CATEGORY_WORDS) {
		for (const word of parts) {
			if (rule.stems.some((stem) => carriesStem(word, stem))) return rule.category;
		}
	}
	return DEFAULT_CATEGORY;
}

/**
 * The listing writes timestamps two different ways, and only one of them is valid ISO 8601.
 *
 * A timed activity gives `2026-09-18T18:00+02:00` — **no seconds**. A whole-day one gives
 * `2026-10-06T23:59:59+02:00` — **with seconds**. `isoWithOffset` in `packages/core` requires
 * seconds (it is what `events.starts_at` is written from, and it exists so an importer cannot
 * quietly drop precision), so the short form has to be filled out before anything downstream sees
 * it.
 *
 * The offset is carried through exactly as written and never folded to UTC (`schema.ts`, the
 * `starts_at` comment): `Date` resolves the instant correctly from either, and rewriting a source's
 * `+02:00` as `Z` throws away the only evidence of which wall clock the organiser meant.
 *
 * Returns null for anything else, so an unreadable timestamp becomes a reported rejection rather
 * than an `Invalid Date` written to the database.
 */
const DATETIME =
	/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})$/;

export function normaliseDateTime(value: string): string | null {
	const match = DATETIME.exec(value.trim());
	if (!match) return null;
	const [, date, hour, minute, second, fraction, zone] = match;
	if (!date || !hour || !minute || !zone) return null;
	// `+0200` and `+02:00` are the same offset written two ways; the schema wants the colon.
	const offset = zone === 'Z' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
	return `${date}T${hour}:${minute}:${second ?? '00'}${fraction ?? ''}${offset}`;
}

/** The local wall clock a normalised timestamp states, `HH:MM:SS`. */
function localClock(normalised: string): string {
	return normalised.slice(11, 19);
}

/**
 * Whether the source is describing a whole day rather than a moment.
 *
 * Bakhagen encodes it structurally — start at local `00:00`, end at local `23:59:59` — and also
 * in words, printing the literal `(heldags)` where a timed card prints `18:00`. Both are read:
 * the structure is language-independent and survives a copy edit, the label survives a change in
 * how the template writes timestamps. Either one is enough.
 */
export function isAllDay(
	startNormalised: string,
	endNormalised: string | null,
	clockLabel: string | null
): boolean {
	const structural =
		localClock(startNormalised) === '00:00:00' &&
		endNormalised !== null &&
		localClock(endNormalised) === '23:59:59';
	// A card with no clock element at all says nothing; only a printed non-clock does.
	const textual = clockLabel !== null && !/^\d{1,2}[:.]\d{2}/.test(clockLabel);
	return structural || textual;
}

/**
 * Some hagelag write the whole postal address into the Place's `name`: Ski's cards say
 * "Ski Menighetshus, Rådhussvingen 1, 1400 Ski". The sibling `PostalAddress` span the template
 * renders for it is empty on every card seen, so the address has nowhere else to have gone.
 *
 * The venue is the part before the first comma. The rest is dropped rather than stored, because
 * `venues` has a name, a municipality and coordinates and no field an address line belongs in —
 * and a venue slugged from a full street address would never match the same hall named plainly by
 * another source, which is precisely what `pnpm consolidate` needs it to do.
 */
export function venueNameFrom(location: string): string {
	const [first] = location.split(',');
	return (first ?? '').trim();
}

export function slugifyVenue(name: string): string {
	return name
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

/**
 * One occurrence's identity.
 *
 * The same shape `importers/mec` settled on, for the same reason. `data-articleId` identifies the
 * *activity*, and Corepublish hangs occurrences off one activity — every card carries an
 * `?instance=N` in its link, which is only meaningful because N can be more than 0. Keying on the
 * article alone would collapse a repeating activity into a single row that jumps date every time
 * the earliest occurrence passes.
 *
 * The instant is used in its UTC form so a template that starts writing `+01:00` as `Z` cannot
 * silently create a second copy of an event we already hold.
 *
 * The cost is the other way round: an activity that is *moved* upstream arrives as a new row and
 * leaves the old one behind. That is the trade MEC made too — a duplicate is visible and
 * correctable, a series quietly collapsed into one drifting row is neither.
 */
export function occurrenceId(articleId: string, startsAt: Date): string {
	return `${articleId}@${startsAt.toISOString()}`;
}

export type MappedEvent = {
	externalId: string;
	title: string;
	category: CategorySlug;
	startsAt: Date;
	endsAt: Date | null;
	venueName: string | null;
	venueSlug: string | null;
	description: string | null;
	ctaUrl: string | null;
	posterUrl: string | null;
	posterRightsVerified: boolean;
	sourceUrl: string;
};

export type MapFailure = { externalId: string; title: string; problem: string };

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}

export function mapEvent(
	input: RawEvent,
	detail: UpstreamDetail | null,
	instance: BakhagenInstance
): MappedEvent | MapFailure {
	const startNormalised = normaliseDateTime(input.startDateTime);
	if (!startNormalised) {
		return {
			externalId: input.articleId,
			title: input.title,
			problem: `unreadable startDate: ${input.startDateTime}`
		};
	}

	const startsAt = new Date(startNormalised);
	if (Number.isNaN(startsAt.getTime())) {
		return {
			externalId: input.articleId,
			title: input.title,
			problem: `unparseable startDate: ${input.startDateTime}`
		};
	}

	const endNormalised = input.endDateTime ? normaliseDateTime(input.endDateTime) : null;
	let endsAt: Date | null = null;
	if (endNormalised) {
		const parsed = new Date(endNormalised);
		// An end that is not after the start is not an end. Dropped rather than stored, which is
		// what the UI already expects of an event whose duration nobody stated.
		if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > startsAt.getTime()) endsAt = parsed;
	}

	/*
	 * Whole-day activities: the source's own span is kept, unchanged.
	 *
	 * Bakhagen states a whole-day activity as local 00:00 -> local 23:59:59 and prints "(heldags)"
	 * where a clock would go. Three things were possible and two were rejected:
	 *
	 *   - Invent a plausible start hour (say 10:00) so the card reads sensibly. That is fabricating
	 *     a time the organiser never gave, on a site people use to decide when to turn up. No.
	 *   - Reject the activity for having no time. It loses a real event over a detail the source
	 *     was explicit about. No.
	 *   - Keep exactly what the source said. Yes.
	 *
	 * So a whole-day activity is stored starting at local midnight and ending at local 23:59:59.
	 * That span is not a coincidence and not lossy: `starts_at` at local midnight together with
	 * `ends_at` at local 23:59:59 the same day is an unambiguous, recoverable encoding of "all
	 * day", which a later change to `EventCard` can read back and render as "Heile dagen" instead
	 * of a clock. Until that lands the card shows 00:00, which under-informs; the alternative was
	 * to mis-inform, and the day - the part that decides whether you can go - is right either way.
	 *
	 * `isAllDay` therefore exists to name and test the condition, not to change the output. It is
	 * the hook the display change will read, and it keeps this decision visible rather than
	 * leaving it as an unexplained pair of timestamps.
	 */

	const rawVenue = venueNameFrom(input.location);
	const venueName = rawVenue || instance.venueFallback;

	/*
	 * The description comes from the activity's own page, when we could read it. It is the one
	 * field the listing does not carry, and a detail fetch that fails costs a description rather
	 * than the event.
	 */
	const description = detail?.description?.trim() || null;

	return {
		externalId: occurrenceId(input.articleId, startsAt),
		title: input.title,
		category: mapCategory(input.title),
		startsAt,
		endsAt,
		venueName,
		venueSlug: slugifyVenue(venueName),
		description,
		// The card links to the activity's own page and there is no ticketing anywhere on
		// Bakhagen — hagelag activities are free or paid at the door. `sourceUrl` is the link.
		ctaUrl: null,
		/*
		 * No images at all in the Event markup, on the card or on the activity page — the JSON-LD
		 * on a detail page carries no `image` either. There is nothing to hotlink and therefore
		 * nothing to have rights over, which is why the instance config records no rights claim:
		 * an unstated right is not a granted one, and here there is not even a picture to claim.
		 */
		posterUrl: null,
		posterRightsVerified: false,
		sourceUrl: input.sourceUrl
	};
}
