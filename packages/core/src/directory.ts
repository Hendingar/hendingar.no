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
 * Three entries have graduated out of this list: Kulleseidkanalen to importers/checkin, Bømlo
 * kyrkjelege fellesråd to importers/kyrkja once it turned out its calendar was readable after all
 * — JSON-escaped inside a script tag rather than absent — and `riksteatret-bomlo` to
 * importers/riksteatret, which reads the `datetime` attribute the venue page puts on every
 * performance. Each importer upserts the same slug, so the row changes kind in place, which is why
 * `pnpm db:sources` skips any slug an importer has taken over.
 *
 * Emptying the list is the goal; it is not, however, a state the app can be left in. /datasamling
 * renders a link row differently from a collected one — "Ikkje henta", no run strip, an outbound
 * link instead of a listing filter — and two e2e specs assert exactly that. With no entry here the
 * CI database holds no link row and those specs test nothing. So a graduation is also a prompt to
 * name the next calendar we know about and do not yet collect.
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
		slug: 'bomlo-teater',
		name: 'Bømlo Teater',
		url: 'https://bomloteater.no/produksjonar/',
		region: 'Sunnhordland',
		attribution: 'Bømlo Teater',
		iconUrl: 'https://bomloteater.no/wp-content/uploads/2022/11/cropped-bt-favicon-192x192.png',
		/*
		 * Checked rather than assumed: the site runs WordPress with The Events Calendar installed,
		 * and `/wp-json/tribe/events/v1/events` answers 200 with `total: 0`. The plugin is there and
		 * nobody fills it in — the productions are hand-written pages with the dates in prose and
		 * not a single `<time>` element between them. So there is a real local calendar here and
		 * nothing machine-readable to import from it.
		 */
		note: 'Oppsetjingane til Bømlo Teater. Sida har ein tom hendingskalender, og datoane står som fritekst på kvar produksjonsside, så det er ikkje noko maskinlesbart å hente enno.'
	}
];

/**
 * Platforms: one upstream product, many organisers.
 *
 * Most sources are a place with a calendar — one organisation, one row on /kjelder, and the page
 * reads as a list of who we collect from. A platform is different: AllEvents and Billetto are
 * products that many local organisers publish on, and we add profiles as we find them. Four rows
 * saying "AllEvents" among fourteen saying a real organisation's name buries the fourteen, and it
 * misreports the answer as well — a reader counting rows would think we watch more places than we
 * do, when what grew was one integration.
 *
 * So a platform's organisers are grouped under it. Each still keeps its own `sources` row, because
 * each is fetched independently and writes its own `ingest_runs` row: one combined row would hide
 * which profile stopped reporting, which is the whole point of that page.
 *
 * Identified by slug prefix rather than by a column, deliberately. The prefix is already the
 * convention every platform importer follows (`billetto-bremnes-idrettslag`, `dnt-stord-fitjar`),
 * so adding an organiser stays a single config entry in its importer and needs no second edit
 * here, no migration, and no chance of the two drifting apart. `sourcesFor` in the seed script and
 * `platformOf` below are the only readers.
 */
export type SourcePlatform = {
	/** Also the slug prefix every one of its sources carries, with the hyphen implied. */
	slug: string;
	name: string;
	url: string;
	/** One sentence for a reader, saying what the platform is and what that means for the data. */
	note: string;
};

export const SOURCE_PLATFORMS: readonly SourcePlatform[] = [
	{
		slug: 'allevents',
		name: 'AllEvents',
		url: 'https://allevents.in',
		note: 'Ein internasjonal hendingsportal der lokale arrangørar legg ut det dei har på gang. Vi hentar frå kvar arrangør for seg, så du ser kven hendinga faktisk kjem frå.'
	},
	{
		slug: 'billetto',
		name: 'Billetto',
		url: 'https://billetto.no',
		note: 'Billettplattform. Vi følgjer arrangørar herifrå ein for ein, etter kvart som vi finn dei.'
	},
	{
		slug: 'dnt',
		name: 'Den Norske Turistforening',
		url: 'https://www.dnt.no',
		note: 'Turlaga sine eigne aktivitetskalendrar, eitt lag om gongen.'
	},
	{
		slug: 'riksteatret',
		name: 'Riksteatret',
		url: 'https://www.riksteatret.no',
		/*
		 * A platform in the sense this list means it — one upstream, many local rows — even though
		 * it is one organisation rather than a product other organisers publish on. What it shares
		 * with the others is the shape: the same repertoire tours ~79 halls, each hall has its own
		 * page, and we collect one source per hall so a hall that stops reporting is visible on its
		 * own line. Grouping them keeps "Riksteatret" one entry on /kjelder instead of one per town.
		 */
		note: 'Turnéteateret som spelar i kulturhus over heile landet. Vi hentar programmet for kvar spelestad for seg, så du ser kva som kjem til akkurat den salen.'
	}
];

/**
 * Which platform a source belongs to, or null if it stands on its own.
 *
 * Matches on `<platform>-` so a source called `dntx-noko` is not swept into DNT. A source whose
 * whole slug equals a platform name is not a match either: a platform is a grouping of organisers
 * and never itself a row.
 */
export function platformOf(sourceSlug: string): SourcePlatform | null {
	return SOURCE_PLATFORMS.find((p) => sourceSlug.startsWith(`${p.slug}-`)) ?? null;
}
