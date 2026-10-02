/**
 * Which sources get the garden card.
 *
 * Hageselskapet's local societies publish on Bakhagen, and their activity pages carry no picture
 * of any kind: no image in the Event markup, none on the card, and an empty `og:image` — which
 * `importers/bakhagen` records by storing `posterUrl: null` for every row. So a fermenteringskurs
 * has nothing to show and never will, and that is exactly the case a card of its own is for.
 *
 * Matched on the `-hagelag` suffix rather than on a list of slugs, because that is how the
 * importer names them: `bomlo-hagelag` today, `stord-hagelag` the day somebody adds it, and the
 * card follows without anybody remembering to come back here. The suffix is checked with the
 * hyphen so a source that merely ends in those letters is not swept in.
 */
export function isGardenSource(slug: string): boolean {
	return slug.endsWith('-hagelag');
}

/** True when any of the sources reporting an event is a hagelag. */
export function hasGardenSource(slugs: readonly string[] | undefined): boolean {
	return (slugs ?? []).some(isGardenSource);
}
