/**
 * Turning a source's idea of an address into ours.
 *
 * `location.address` is REQUIRED for Google's Event rich result, and until now no event had one:
 * `venues.address` was empty for every row in the database. It was never a hard problem — three
 * sources hand us a real street address in the same payload we already fetch, and every importer
 * threw it away because there was nowhere to put it.
 *
 * A geocoder was the other candidate and was tried first. Kartverket's place-name register, tested
 * against sixteen real Sunnhordland venues, matched five correctly, matched four *wrongly* —
 * "Øklandstunet" resolved to Øklandsvatnet, a lake — and did not contain Stord kulturhus at all.
 * A wrong address on an event listing sends somebody to the wrong building, which is worse than no
 * address at all. So: the sources that know, and silence from the ones that do not.
 *
 * Pure. No I/O, no clock, no network — this is `map.ts` logic that three importers share, so per
 * CLAUDE.md rule 1 it lives here rather than being written three times.
 */

/** What a venue row can learn from a source. Every field independently optional. */
export type ParsedAddress = {
	/** House number and street, as a person would write it: "Kjøtteinsvegen 66". */
	street: string | null;
	/** Norwegian postnummer, exactly four digits, or null. */
	postalCode: string | null;
	/** Post town or municipality, title-cased: "Leirvik". Sources shout it as often as not. */
	city: string | null;
};

export const NO_ADDRESS: ParsedAddress = { street: null, postalCode: null, city: null };

/** `FINNÅS` → `Finnås`, `stord` → `Stord`. Left alone if it is already mixed case. */
export function titleCasePlace(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	if (trimmed !== trimmed.toUpperCase() && trimmed !== trimmed.toLowerCase()) return trimmed;
	return trimmed
		.toLowerCase()
		.replace(
			/(^|[\s\-/])(\p{L})/gu,
			(_, boundary: string, letter: string) => boundary + letter.toUpperCase()
		);
}

/**
 * Fields a source already keeps apart — a street, a postnummer and a town in three columns.
 *
 * The clean case, and the one to prefer wherever a source offers it: nothing is being inferred.
 */
export function fromParts(
	street: string | null | undefined,
	postalCode: string | null | undefined,
	city: string | null | undefined
): ParsedAddress {
	return {
		street: cleanStreet(street),
		postalCode: cleanPostalCode(postalCode),
		city: city?.trim() ? titleCasePlace(city) : null
	};
}

/**
 * One free-text line, the way allevents.in writes it.
 *
 * Real values from the committed fixtures:
 *
 *   "Sagvågsbrekko 7, 5410 Sagvåg, Norge"
 *   "Kjøtteinsvegen 67,Stord Island, Hordaland, Norway"
 *
 * The first segment is the street. A `NNNN Town` segment anywhere is the postnummer and post town.
 * Everything else — county, country, "Stord Island" — is discarded rather than guessed at, because
 * a segment we cannot name is not a field we should fill.
 *
 * Returns nothing at all unless the first segment actually looks like a street address. A venue
 * name sitting in a `street` field ("Stord Hotell, …") must not become `streetAddress`, or the
 * JSON-LD asserts a street that does not exist.
 */
export function fromLine(line: string | null | undefined): ParsedAddress {
	const segments = (line ?? '')
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
	if (segments.length === 0) return NO_ADDRESS;

	/*
	 * The first segment that looks like a street, not necessarily the first segment.
	 *
	 * allevents.in writes "Stord Hotell, Kjøtteinsvegen 66, 5411 Leirvik, Norge" — venue name
	 * first — as often as it writes the street first. Insisting on segment zero threw that address
	 * away. Scanning costs nothing in precision: a segment only qualifies if it has both a digit
	 * and a letter, which is the same test either way.
	 */
	const street = segments.map(cleanStreet).find(Boolean) ?? null;
	if (!street) return NO_ADDRESS;

	// `5410 Sagvåg`, in whichever segment it turns up. Anchored so a house number cannot pass for
	// a postnummer and a year in a venue name cannot either.
	const postal = segments.find((part) => part !== street && /^\d{4}(\s+\S|$)/.test(part));
	const match = postal ? /^(\d{4})\s*(.*)$/.exec(postal) : null;

	return {
		street,
		postalCode: match?.[1] ?? null,
		city: match?.[2]?.trim() ? titleCasePlace(match[2]) : null
	};
}

/**
 * A street address, or nothing.
 *
 * The test is a house number, because that is what separates "Kjøtteinsvegen 66" from
 * "Kulturhuset i Vaskerelven" — which is what HVL puts in its `adress` field, and which is a room,
 * not an address. Publishing that as `streetAddress` would be a claim about a place that is not
 * true anywhere.
 */
function cleanStreet(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed || trimmed.length > 120) return null;
	return /\d/.test(trimmed) && /\p{L}/u.test(trimmed) ? trimmed : null;
}

/** Four digits, and nothing that merely contains four digits. */
function cleanPostalCode(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed && /^\d{4}$/.test(trimmed) ? trimmed : null;
}
