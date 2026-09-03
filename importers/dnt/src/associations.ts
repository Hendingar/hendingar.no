/**
 * The DNT member associations (turlag) we import from.
 *
 * DNT runs one national activity calendar on dnt.no; a turlag is a filter over it, not a site of
 * its own. So this is a platform importer in the same sense as `mec` — one parser, the turlag as
 * data — and adding another turlag is an entry here, not a new package.
 *
 * `associationId` is the `associations` query parameter in the public calendar URL. Read it off
 * the turlag's own "vår aktivitetskalender" link rather than guessing: the ids are EPiServer
 * organisation ids and are not derivable from the name.
 */
export type DntAssociation = {
	/** Our `sources.slug`. Stable — changing it orphans every imported event. */
	slug: string;
	name: string;
	/** DNT's `associations` filter id. */
	associationId: string;
	region: string;
	attribution: string;
	timezone: string;
	scheduleCron: string;
	iconUrl: string | null;
	/**
	 * Editorially maintained by the turlag's own trip committee, so imports publish directly
	 * rather than queueing for review. See the `trusted` column comment in schema.ts.
	 */
	trusted: boolean;
};

export const ASSOCIATIONS: readonly DntAssociation[] = [
	{
		slug: 'dnt-stord-fitjar',
		name: 'DNT Stord-Fitjar',
		associationId: '25194',
		region: 'Sunnhordland',
		attribution: 'DNT Stord-Fitjar',
		timezone: 'Europe/Oslo',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://www.dnt.no/favicon-32x32.png',
		trusted: true
	},
	{
		slug: 'dnt-bomlo',
		name: 'Bømlo Turlag',
		associationId: '25197',
		region: 'Sunnhordland',
		attribution: 'Bømlo Turlag',
		timezone: 'Europe/Oslo',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://www.dnt.no/favicon-32x32.png',
		trusted: true
	}
];

/** The public calendar page a reader can open, filtered to this turlag. */
export function calendarUrl(association: DntAssociation): string {
	return `https://www.dnt.no/aktivitetskalender/?associations=${association.associationId}&culture=nb-NO`;
}

/** The JSON endpoint behind that page. Same query string — the page and the API agree by design. */
export function apiUrl(association: DntAssociation, page: number): string {
	return `https://www.dnt.no/api/activities?associations=${association.associationId}&culture=nb-NO&page=${page}`;
}

/** Per-activity description and outbound sign-up link. */
export function detailsUrl(activityId: number): string {
	return `https://www.dnt.no/api/search/activitydetails?id=${activityId}`;
}

export function associationBySlug(slug: string): DntAssociation | undefined {
	return ASSOCIATIONS.find((a) => a.slug === slug);
}
