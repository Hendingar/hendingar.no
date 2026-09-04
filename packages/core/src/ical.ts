/**
 * One event as an iCalendar file, so a reader can put it in their own calendar.
 *
 * Pure: no I/O, no clock beyond what the caller supplies. Written by hand rather than pulled from a
 * dependency because a single VEVENT needs perhaps sixty lines of RFC 5545, and the two parts that
 * are genuinely easy to get wrong — text escaping and line folding — are exactly the parts a
 * library would hide. Both are tested.
 */

export type IcalEvent = {
	/** Our own event id. Becomes the UID, so re-downloading updates rather than duplicates. */
	id: number;
	title: string;
	description?: string | null;
	/** The venue as a reader would say it, municipality included when we know it. */
	location?: string | null;
	startsAt: Date;
	endsAt?: Date | null;
	/** Absolute URL of the event's page here. */
	url: string;
	/** Absolute URL at the source, added to the description so the calendar entry can be checked. */
	sourceUrl?: string | null;
};

/**
 * RFC 5545 text escaping.
 *
 * Backslash first, or every escape this function adds gets escaped again by the later rules. A
 * newline becomes a literal `\n`, because a real newline inside a value would end the property and
 * make the rest of the description look like a malformed field.
 */
export function escapeText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\;')
		.replace(/,/g, '\\,')
		.replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a content line to 75 octets, per RFC 5545.
 *
 * Octets, not characters. Norwegian is full of ø and å, which are two bytes each in UTF-8, so
 * counting characters overruns the limit — and splitting between the two bytes of one character
 * produces a file that some parsers reject and others render as mojibake. This walks code points
 * and measures their encoded length, so a multi-byte character is never cut in half.
 *
 * Continuation lines begin with a single space, which the reader strips.
 */
export function foldLine(line: string): string {
	const encoder = new TextEncoder();
	const out: string[] = [];
	let current = '';
	let bytes = 0;
	// A continuation line spends one octet on its leading space.
	let limit = 75;

	for (const char of line) {
		const size = encoder.encode(char).length;
		if (bytes + size > limit) {
			out.push(current);
			current = char;
			bytes = size;
			limit = 74;
		} else {
			current += char;
			bytes += size;
		}
	}
	out.push(current);
	return out.join('\r\n ');
}

/**
 * An instant as UTC, `20260904T183000Z`.
 *
 * UTC rather than a local time with `TZID`, deliberately: a `TZID` is only meaningful if the file
 * also carries a matching `VTIMEZONE` definition, and a wrong or missing one silently shifts the
 * event in the reader's calendar. We store instants, so UTC is what we actually know — every
 * calendar client converts it to the reader's own zone on the way in.
 */
export function toIcalUtc(date: Date): string {
	return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/** The filename a browser should save it as. */
export function icalFilename(id: number, title: string): string {
	const stem = title
		.toLowerCase()
		.replace(/æ/g, 'ae')
		.replace(/ø/g, 'oe')
		.replace(/å/g, 'aa')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	return stem ? `${id}-${stem}.ics` : `${id}.ics`;
}

/**
 * `now` is a parameter so the output is deterministic in tests — DTSTAMP is the only field that
 * would otherwise change on every call.
 */
export function buildIcal(event: IcalEvent, now: Date = new Date()): string {
	const description = [event.description?.trim(), event.sourceUrl?.trim()]
		.filter((part): part is string => Boolean(part))
		.join('\n\n');

	const lines: string[] = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//hendingar.no//NONSGML hendingar//NN',
		'CALSCALE:GREGORIAN',
		/*
		 * PUBLISH, not REQUEST. This is information a reader chose to take a copy of, not an
		 * invitation from us — REQUEST makes some clients treat it as a meeting with attendees and
		 * offer to reply to an organiser that does not exist.
		 */
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		/*
		 * Stable across downloads.
		 *
		 * Downloading the same event twice should update the entry the reader already has rather
		 * than leaving them with two, which is precisely what a random UID per request would do.
		 */
		`UID:hending-${event.id}@hendingar.no`,
		`DTSTAMP:${toIcalUtc(now)}`,
		`DTSTART:${toIcalUtc(event.startsAt)}`
	];

	/*
	 * No end time means no DTEND, rather than an invented one.
	 *
	 * Plenty of our sources publish a start and nothing else. An hour would be a guess, and a guess
	 * in someone's calendar is worse than a gap: they would plan around a time we made up. RFC 5545
	 * gives a DATE-TIME event with no DTEND a zero duration, which clients show as a point in the
	 * day — honest about what we know.
	 */
	if (event.endsAt && event.endsAt.getTime() > event.startsAt.getTime()) {
		lines.push(`DTEND:${toIcalUtc(event.endsAt)}`);
	}

	lines.push(`SUMMARY:${escapeText(event.title.trim())}`);
	if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
	if (event.location?.trim()) lines.push(`LOCATION:${escapeText(event.location.trim())}`);
	lines.push(`URL:${escapeText(event.url)}`);
	lines.push('END:VEVENT', 'END:VCALENDAR');

	// CRLF between lines, and a trailing one: RFC 5545 requires it, and some parsers drop the last
	// property without it.
	return lines.map(foldLine).join('\r\n') + '\r\n';
}
