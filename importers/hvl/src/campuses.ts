/**
 * The HVL campuses we import from.
 *
 * Høgskulen på Vestlandet runs one calendar for all five campuses, so a campus is a filter over it
 * rather than a site of its own — the same shape as the DNT turlag. Only Stord is in Sunnhordland
 * today; adding Haugesund would be an entry here, not a new package.
 */
export type HvlCampus = {
	/** Our `sources.slug`. Stable — changing it orphans every imported event. */
	slug: string;
	name: string;
	/** HVL's `Locations` filter id, as it appears in the calendar URL's `filters` parameter. */
	locationId: string;
	/**
	 * Which addresses count as being *at* this campus.
	 *
	 * This is the whole reason the importer is not a two-line config change. HVL tags an event with
	 * every campus whenever it concerns the whole institution — a Zoom webinar, a board meeting in
	 * Førde, the doctoral ceremony in Bergen — so the campus filter alone answers "is this relevant
	 * to Stord staff", not "is this happening on Stord". Against the calendar as it stood, twenty
	 * events carried the Stord tag and ten of them were in Bergen, Sogndal, Førde or online.
	 *
	 * A reader of this site is deciding whether to leave the house, so the address has to name the
	 * place. `Rommetveit` is the village the Stord campus sits in and appears in room-level
	 * addresses; nothing else on Vestlandet shares the name.
	 *
	 * Deliberately NOT matching bare "biblioteket": every campus has a library, so it would let
	 * Bergen's back in.
	 */
	addressPattern: RegExp;
	region: string;
	attribution: string;
	timezone: string;
	scheduleCron: string;
	iconUrl: string | null;
	/** Editorially maintained by the institution, so imports publish rather than queue for review. */
	trusted: boolean;
};

export const CAMPUSES: readonly HvlCampus[] = [
	{
		slug: 'hvl-stord',
		name: 'HVL campus Stord',
		locationId: 'Stord',
		addressPattern: /stord|rommetveit/i,
		region: 'Sunnhordland',
		attribution: 'Høgskulen på Vestlandet',
		timezone: 'Europe/Oslo',
		scheduleCron: '0 5 * * *',
		iconUrl: null,
		trusted: true
	}
];

/** The public calendar page a reader can open, filtered to this campus. */
export function calendarUrl(campus: HvlCampus): string {
	return `https://www.hvl.no/kalender/?filters=,${campus.locationId}`;
}

/**
 * The month service behind that page.
 *
 * The path is `/{language}/{year}/{month}/{day}/{filters}` — day 0 means the whole month. Read
 * straight out of `internett/js/controllers/calendar-list-controller.js`, which is the only place
 * it is written down.
 */
export function monthUrl(campus: HvlCampus, year: number, month: number): string {
	return `https://www.hvl.no/service/calendar/month/nn-NO/${year}/${month}/0/${campus.locationId}`;
}

export function campusBySlug(slug: string): HvlCampus | undefined {
	return CAMPUSES.find((c) => c.slug === slug);
}
