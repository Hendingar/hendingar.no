import type { Fixture } from '@hendingar/core/fixture';

/**
 * Club kits: the home side's colours, for the cards of the matches we list.
 *
 * Every fixture we hold is a home match (`importers/fotball` drops the travelling), so the card is
 * the home club's card and wears its colours — Bremnes in yellow and black, Stord in white and
 * black. The palettes are tokens in `brand.css` (`.kit--<slug>`), not literals here: a kit
 * re-points `--navy-*` and `--peach-*` on the card, and everything inside it that was drawn in
 * the duotone is drawn in the kit instead. ADR 0023 is why a third hue is allowed at all.
 *
 * Keyed like the crest table: the club name as `parseFixture` produces it, lowercased. A club with
 * no entry keeps the site's own navy and peach.
 */
const KITS: Readonly<Record<string, string>> = {
	bremnes: 'bremnes',
	stord: 'stord',
	'stord fotball': 'stord'
};

/** The class that dresses a card in its home club's colours, or null to leave it in ours. */
export function kitClass(fixture: Fixture | null): string | null {
	if (!fixture) return null;
	const kit = KITS[fixture.home.club.toLowerCase().replace(/\s+/g, ' ').trim()];
	return kit ? `kit--${kit}` : null;
}
