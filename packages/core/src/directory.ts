/**
 * Sources we link to but do not collect.
 *
 * /datasamling exists to say what we gather and how. A calendar we know about and cannot import is
 * part of that answer: leaving it off would let the page imply a completeness we do not have,
 * while naming it gives a reader somewhere useful to go and keeps the gap visible to us.
 *
 * These become `sources` rows with `kind: 'link'`, `active: false`, no endpoint, no schedule and
 * no runs. A row here is a promise about a URL and nothing more.
 *
 * Moving one out of this list is the goal, not a formality: when an importer starts collecting a
 * source it upserts the same slug and the kind changes with it. Keep the slug stable, or the
 * events an importer later writes will hang off a second, duplicate row.
 */
export type LinkedSource = {
	slug: string;
	name: string;
	url: string;
	region: string;
	attribution: string;
	iconUrl: string | null;
	/** Why it is not collected. Shown verbatim, so write it for a reader rather than for us. */
	note: string;
};

/*
 * Two entries have graduated out of this list: Kulleseidkanalen to importers/checkin, and Bømlo
 * kyrkjelege fellesråd to importers/kyrkja once it turned out its calendar was readable after all
 * — JSON-escaped inside a script tag rather than absent. Each importer upserts the same slug, so
 * the row changes kind in place, which is why `pnpm db:sources` skips any slug an importer has
 * taken over.
 */
/**
 * The reserved slug for "sent in by a person".
 *
 * Not a row in `sources`, because a submission does not come from a calendar — it comes from
 * somebody who saw a poster. It behaves like a source everywhere a reader meets one (a chip, a
 * filter, a URL) and nowhere else.
 *
 * Reserved rather than derived, so a real source can never collide with it: `sources.slug` is
 * unique and no importer would pick this, but saying so here is cheaper than finding out.
 */
export const SUBMITTED_SLUG = 'innsendt';

export const LINKED_SOURCES: readonly LinkedSource[] = [
	{
		slug: 'riksteatret-bomlo',
		name: 'Riksteatret på Bømlo',
		url: 'https://www.riksteatret.no/spillested/bomlo/',
		region: 'Sunnhordland',
		attribution: 'Riksteatret',
		iconUrl: 'https://www.riksteatret.no/apple-touch-icon-precomposed.png',
		note: 'Framsyningane til Riksteatret i Bømlo kulturhus. Sida er lesbar og vi planlegg å hente herifrå.'
	}
];
