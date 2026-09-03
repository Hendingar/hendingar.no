/**
 * Church calendars on kyrkja.no, which run DNN with Agrando's calendar module.
 *
 * The page looks unscrapeable and is not. Its HTML contains no dates, no `datetime` attribute and
 * no JSON-LD, because the calendar arrives **JSON-escaped inside a script tag** — `var data =
 * {"d":"<div class=\"year\"..."}` — and is injected by JavaScript on load. Searching the
 * markup for anything date-shaped finds nothing, which is exactly the wrong conclusion: unescape
 * that one string and the whole calendar is there, structured, for months ahead.
 *
 * kyrkja.no hosts a calendar per parish on the same module, so this is a platform importer and the
 * parishes are data.
 */
export type KyrkjaInstance = {
	slug: string;
	name: string;
	/** The page we parse, and the page we attribute to — here they are the same. */
	url: string;
	region: string;
	attribution: string;
	timezone: string;
	/** Used when an event names no church. */
	venueFallback: string;
	iconUrl: string | null;
	scheduleCron: string;
	trusted: boolean;
	posterRightsCleared: boolean;
};

export const INSTANCES: readonly KyrkjaInstance[] = [
	{
		slug: 'bomlo-kyrkja',
		name: 'Bømlo kyrkjelege fellesråd',
		url: 'https://bomlo.kyrkja.no/Kalender',
		region: 'Sunnhordland',
		attribution: 'Bømlo kyrkjelege fellesråd',
		timezone: 'Europe/Oslo',
		venueFallback: 'Bømlo kyrkjelege fellesråd',
		iconUrl: 'https://bomlo.kyrkja.no/favicon.ico',
		scheduleCron: '0 5 * * *',
		trusted: true,
		// The calendar carries no images at all, so there is nothing to have rights over.
		posterRightsCleared: false
	}
];

export function instanceBySlug(slug: string): KyrkjaInstance | undefined {
	return INSTANCES.find((i) => i.slug === slug);
}

export type RawEvent = {
	/** Local calendar date at the church, YYYY-MM-DD. The page gives `dd.mm` and a year heading. */
	localDate: string;
	/** Local wall clock, HH:MM. No zone anywhere on the page. */
	localTime: string;
	title: string;
	/** The church, from `.calendar-location`. */
	location: string;
	/** `.calendar-label`, often empty. Editorial rather than a taxonomy. */
	label: string;
	/** Stable per-occurrence GUID from the link's `OccurenceId`. */
	occurrenceId: string;
	/** Absolute URL to the event on the parish site. */
	href: string;
};

export type ParsedCalendar = { events: RawEvent[]; rejected: string[] };

/** Entities appear inside the escaped HTML; only the handful DNN actually emits. */
function decodeEntities(value: string): string {
	return value
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&oslash;/g, 'ø')
		.replace(/&aring;/g, 'å')
		.replace(/&aelig;/g, 'æ');
}

const clean = (value: string) => decodeEntities(value).replace(/\s+/g, ' ').trim();

/**
 * Pull the calendar out of the page's script tag and unescape it.
 *
 * Returns null when the blob is absent, which is how a redesign should surface — the ingest then
 * fails loudly instead of importing zero events and reporting success.
 */
export function extractCalendarHtml(pageHtml: string): string | null {
	const match = /var data = (\{"d":".*?"\});/s.exec(pageHtml);
	if (!match?.[1]) return null;
	try {
		const parsed: unknown = JSON.parse(match[1]);
		if (typeof parsed === 'object' && parsed !== null && 'd' in parsed) {
			const d = (parsed as { d: unknown }).d;
			return typeof d === 'string' ? d : null;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Pure: unescaped calendar HTML → events.
 *
 * The year comes from `<div class="year">` headings, and it matters: dates are printed `dd.mm`
 * with no year, and this calendar runs from September to the following May. Reading the year from
 * the clock instead would file every spring event twelve months early.
 */
export function parseCalendar(calendarHtml: string, baseUrl: string): ParsedCalendar {
	const events: RawEvent[] = [];
	const rejected: string[] = [];

	const yearMarks = [...calendarHtml.matchAll(/<div class="year">(\d{4})<\/div>/g)].map((m) => ({
		at: m.index ?? 0,
		year: m[1]!
	}));

	const yearAt = (position: number): string | null => {
		let found: string | null = null;
		for (const mark of yearMarks) {
			if (mark.at <= position) found = mark.year;
			else break;
		}
		return found;
	};

	const items = calendarHtml.matchAll(
		/<div class="calendar-item">([\s\S]*?)(?=<div class="calendar-item">|<div class="year">|$)/g
	);

	for (const item of items) {
		const body = item[1] ?? '';
		const date = /<div class="calendar-date">\s*([0-3]?\d)\.(1[0-2]|0?\d)\s*<\/div>/.exec(body);
		if (!date) {
			rejected.push('a calendar-item with no readable date');
			continue;
		}
		const year = yearAt(item.index ?? 0);
		if (!year) {
			rejected.push(`no year heading precedes ${date[1]}.${date[2]}`);
			continue;
		}
		const localDate = `${year}-${String(Number(date[2])).padStart(2, '0')}-${String(
			Number(date[1])
		).padStart(2, '0')}`;

		for (const ev of body.matchAll(/<div class="event">([\s\S]*?)(?=<div class="event">|$)/g)) {
			const block = ev[1] ?? '';
			const anchor = /<p class="info-text">\s*<a href="([^"]+)"\s*>([\s\S]*?)<\/a>/.exec(block);
			if (!anchor) continue;

			const title = clean(anchor[2]!.replace(/<[^>]+>/g, ''));
			if (!title) {
				rejected.push(`${localDate}: an event with no title`);
				continue;
			}

			const occurrence = /OccurenceId=([0-9a-fA-F-]{8,})/.exec(anchor[1]!);
			if (!occurrence) {
				// Without it there is no stable identity, and a title is not one — the same event
				// would duplicate the first time someone fixes a typo.
				rejected.push(`${localDate} ${title}: no OccurenceId in the link`);
				continue;
			}

			const time = /<div class="event-time">\s*kl\.?\s*(\d{1,2})[.:](\d{2})/.exec(block);
			if (!time) {
				rejected.push(`${localDate} ${title}: no readable time`);
				continue;
			}

			const location = /<span class="calendar-location">([\s\S]*?)<\/span>/.exec(block);
			const label = /<span class="calendar-label">([\s\S]*?)<\/span>/.exec(block);

			events.push({
				localDate,
				localTime: `${String(Number(time[1])).padStart(2, '0')}:${time[2]}`,
				title,
				location: location ? clean(location[1]!) : '',
				label: label ? clean(label[1]!) : '',
				occurrenceId: occurrence[1]!.toLowerCase(),
				href: new URL(decodeEntities(anchor[1]!), baseUrl).toString()
			});
		}
	}

	return { events, rejected };
}

export type FetchCalendar = (instance: KyrkjaInstance) => Promise<string>;

export const fetchCalendar: FetchCalendar = async (instance) => {
	const response = await fetch(instance.url, {
		headers: {
			'user-agent': 'hendingar.no importer (+https://hendingar.no)',
			accept: 'text/html'
		},
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new Error(`${instance.url} responded ${response.status}`);
	return response.text();
};
