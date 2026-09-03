/**
 * Just enough iCalendar to read a fixture list.
 *
 * A dependency would be the obvious call and is the wrong one here: NFF's feed uses ten properties,
 * no recurrence, no attendees, no alarms and no timezone definitions beyond a `TZID` name. What it
 * does need is exactly right — line unfolding and value unescaping — and both are places a
 * hand-rolled reader usually goes wrong, so both are tested against the committed feed.
 *
 * Pure: no I/O, no clock (CLAUDE.md rule 6).
 */

export type IcalEvent = {
	uid: string | null;
	summary: string | null;
	description: string | null;
	location: string | null;
	url: string | null;
	/** Local wall clock as `YYYYMMDDTHHMMSS`, with the zone named separately. */
	start: { value: string; tzid: string | null } | null;
	end: { value: string; tzid: string | null } | null;
};

/**
 * Undo RFC 5545 line folding.
 *
 * A long value is split across lines with a single space or tab starting each continuation, so a
 * `DESCRIPTION` arrives in four pieces. Reading the file line by line without this gives a
 * truncated value and a handful of lines that look like malformed properties — and it silently
 * chops venue names, which is what this importer filters on.
 */
export function unfold(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

/**
 * Undo value escaping. `\n` is a real newline, and `\,` `\;` `\\` are literal characters.
 *
 * The order matters: unescaping backslashes first would turn `\\n` — a literal backslash followed
 * by an n — into a newline.
 */
export function unescapeValue(value: string): string {
	return value.replace(/\\([\;,nN])/g, (_, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}

type Property = { params: Record<string, string>; value: string };

function parseProperty(line: string): { name: string; property: Property } | null {
	// Split on the first colon that is not inside a quoted parameter value.
	let colon = -1;
	let quoted = false;
	for (let i = 0; i < line.length; i += 1) {
		const ch = line[i];
		if (ch === '"') quoted = !quoted;
		else if (ch === ':' && !quoted) {
			colon = i;
			break;
		}
	}
	if (colon === -1) return null;

	const head = line.slice(0, colon);
	const value = line.slice(colon + 1);
	const [name, ...paramParts] = head.split(';');
	if (!name) return null;

	const params: Record<string, string> = {};
	for (const part of paramParts) {
		const eq = part.indexOf('=');
		if (eq === -1) continue;
		params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
	}
	return { name: name.toUpperCase(), property: { params, value } };
}

export function parseIcal(text: string): IcalEvent[] {
	const events: IcalEvent[] = [];
	let current: Record<string, Property> | null = null;

	for (const line of unfold(text).split('\n')) {
		if (line === 'BEGIN:VEVENT') {
			current = {};
			continue;
		}
		if (line === 'END:VEVENT') {
			if (current) events.push(toEvent(current));
			current = null;
			continue;
		}
		if (!current) continue;
		const parsed = parseProperty(line);
		// First wins: a malformed feed repeating a property must not silently change the answer
		// depending on order.
		if (parsed && !(parsed.name in current)) current[parsed.name] = parsed.property;
	}

	return events;
}

function text(property: Property | undefined): string | null {
	if (!property) return null;
	const value = unescapeValue(property.value).trim();
	return value || null;
}

function stamp(property: Property | undefined): IcalEvent['start'] {
	if (!property) return null;
	const value = property.value.trim();
	// `20260321T140000`, and the UTC form `…Z`, which the feed does not use but a fixed feed might.
	if (!/^\d{8}T\d{6}Z?$/.test(value)) return null;
	return { value, tzid: property.params.TZID ?? (value.endsWith('Z') ? 'UTC' : null) };
}

function toEvent(properties: Record<string, Property>): IcalEvent {
	return {
		uid: text(properties.UID),
		summary: text(properties.SUMMARY),
		description: text(properties.DESCRIPTION),
		location: text(properties.LOCATION),
		url: text(properties.URL),
		start: stamp(properties.DTSTART),
		end: stamp(properties.DTEND)
	};
}
