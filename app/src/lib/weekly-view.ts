import { addDays, MONTH_NAMES, WEEKDAY_NAMES, weekdayIndex } from '@hendingar/core/datetime';
import {
	AGE_BANDS,
	describeWeeklyHours,
	fitsAgeBand,
	isAgeBand,
	slotsOn,
	type AgeBand,
	type WeeklyHours
} from '@hendingar/core/weekly-hours';

/**
 * `/alltid-ope`'s two readings of the weekly activities: by day, and by who runs them.
 *
 * Pure, and run on both sides — the page computes it from the URL during SSR and again while
 * hydrating — so nothing here may depend on where it runs. That is why sorting below is a
 * hand-written comparison and not `Intl.Collator('nb')`: browser ICU and Node's disagree on which
 * locales exist (CLAUDE.md records `nn-NO`), and a different order on each side is a hydration
 * mismatch.
 *
 * The day lens answers "kva kan eg bli med på i dag?" — the question the folds-by-club page made
 * people dig for. Each weekday in the strip means its NEXT date, today included, so a fortnightly
 * service is shown on the Sunday it actually meets and not on the one it does not (`slotsOn`).
 */

/** The shape this module reads. Structural, so the server query's rows fit without a cast. */
export type WeeklyActivityRow = {
	id: number;
	title: string;
	weeklyHours: WeeklyHours | null;
	ageFrom: number | null;
	ageTo: number | null;
	venueName: string | null;
	organizerName: string | null;
};

/** URL words for the weekdays, måndag first. ASCII, because they are typed and shared. */
export const DAY_SLUGS = [
	'mandag',
	'tysdag',
	'onsdag',
	'torsdag',
	'fredag',
	'laurdag',
	'sundag'
] as const;
const DAY_SHORT = ['Må', 'Ty', 'On', 'To', 'Fr', 'La', 'Su'] as const;

export type WeeklyParams = { day: number | null; band: AgeBand | null };

/** `?dag=laurdag&for=born` → which weekday (0 = måndag) and which age band. Unknown words: none. */
export function parseWeeklyParams(params: Pick<URLSearchParams, 'get'>): WeeklyParams {
	const dag = params.get('dag');
	const index = DAY_SLUGS.findIndex((s) => s === dag);
	const band = params.get('for');
	return { day: index >= 0 ? index : null, band: isAgeBand(band) ? band : null };
}

/**
 * The address for a choice. Every link on the lens is built here, so the strip and the chips can
 * never drop each other's parameter.
 *
 * `#dag` lands the reader back on the lens rather than at the top of the page, which matters
 * without JavaScript, where every tap is a full page load.
 */
export function weeklyHref(day: number | null, band: AgeBand | null): string {
	const params = new URLSearchParams();
	if (day !== null) params.set('dag', DAY_SLUGS[day] ?? 'mandag');
	if (band !== null) params.set('for', band);
	const query = params.toString();
	return `/alltid-ope${query ? `?${query}` : ''}#dag`;
}

/** The next date that is this weekday, today included. */
export function nextDateFor(today: string, day: number): string {
	return addDays(today, (day - weekdayIndex(today) + 7) % 7);
}

function fits(a: WeeklyActivityRow, band: AgeBand | null): boolean {
	return band === null || fitsAgeBand(a.ageFrom, a.ageTo, band);
}

export type WeekDay = {
	index: number;
	slug: string;
	short: string;
	date: string;
	dayOfMonth: number;
	isToday: boolean;
	count: number;
};

/** The strip: måndag to sundag, each its next date, each with how many meet then. */
export function weekStrip(
	activities: readonly WeeklyActivityRow[],
	today: string,
	band: AgeBand | null
): WeekDay[] {
	return DAY_SLUGS.map((slug, index) => {
		const date = nextDateFor(today, index);
		return {
			index,
			slug,
			short: DAY_SHORT[index] ?? '',
			date,
			dayOfMonth: Number(date.slice(8, 10)),
			isToday: date === today,
			count: activities.filter(
				(a) => a.weeklyHours && fits(a, band) && slotsOn(a.weeklyHours, date).length > 0
			).length
		};
	});
}

export type DayRow = {
	id: number;
	title: string;
	organizer: string | null;
	venue: string | null;
	from: string;
	to: string | null;
	/** "Partalsveker" — said even though it is on, so nobody assumes the next week too. */
	cadence: string | null;
};

export type DayPeriod = { name: string; rows: DayRow[] };

const PERIODS: ReadonlyArray<{ name: string; until: number }> = [
	{ name: 'Føremiddag', until: 12 },
	{ name: 'Ettermiddag', until: 17 },
	{ name: 'Kveld', until: 24 }
];

/**
 * What meets on one date, by time, in three parts of the day.
 *
 * One row per slot, not per activity: a swimming hall open for laps morning and evening is two
 * things a reader could go to. Periods that come out empty are left out rather than shown bare.
 */
export function dayView(
	activities: readonly WeeklyActivityRow[],
	date: string,
	band: AgeBand | null
): { periods: DayPeriod[]; count: number } {
	const rows: DayRow[] = [];
	for (const a of activities) {
		if (!a.weeklyHours || !fits(a, band)) continue;
		const cadence = describeWeeklyHours(a.weeklyHours).cadence;
		for (const slot of slotsOn(a.weeklyHours, date)) {
			rows.push({
				id: a.id,
				title: a.title,
				organizer: a.organizerName,
				venue: a.venueName,
				from: slot.from,
				to: slot.to,
				cadence
			});
		}
	}
	rows.sort((x, y) => x.from.localeCompare(y.from) || readingOrder(x.title, y.title));

	let start = 0;
	const periods = PERIODS.map(({ name, until }) => {
		const inPeriod = rows.filter((r) => {
			const hour = Number(r.from.slice(0, 2));
			return hour >= start && hour < until;
		});
		start = until;
		return { name, rows: inPeriod };
	}).filter((p) => p.rows.length > 0);

	return { periods, count: activities.filter((a) => rows.some((r) => r.id === a.id)).length };
}

export type Club = {
	name: string | null;
	/** Which weekdays it meets on at all, måndag first — the strip on its card. */
	meets: boolean[];
	activities: Array<{ id: number; title: string; lines: string[]; cadence: string | null }>;
};

/**
 * One card per organiser, biggest first.
 *
 * Size first, unlike the places above it: here the count is information — "47 aktivitetar" says
 * this is the club with something for every age — and the biggest card is the one most readers
 * are looking for. Ties alphabetically; an activity with no organiser goes last, unnamed.
 */
export function clubsOf(activities: readonly WeeklyActivityRow[]): Club[] {
	const byName = new Map<string | null, Club>();
	for (const a of activities) {
		if (!a.weeklyHours) continue;
		const club = byName.get(a.organizerName) ?? {
			name: a.organizerName,
			meets: [false, false, false, false, false, false, false],
			activities: []
		};
		for (const slot of a.weeklyHours.slots) club.meets[slot.weekday - 1] = true;
		const text = describeWeeklyHours(a.weeklyHours);
		club.activities.push({ id: a.id, title: a.title, lines: text.lines, cadence: text.cadence });
		byName.set(a.organizerName, club);
	}
	const clubs = [...byName.values()];
	for (const club of clubs) club.activities.sort((x, y) => readingOrder(x.title, y.title));
	return clubs.sort((x, y) => {
		if (x.name === null || y.name === null) return x.name === null ? 1 : -1;
		return y.activities.length - x.activities.length || readingOrder(x.name, y.name);
	});
}

/** "laurdag 3. oktober". The year is never in doubt inside a seven-day window. */
export function dayLabel(date: string): string {
	const month = MONTH_NAMES[Number(date.slice(5, 7)) - 1] ?? '';
	return `${WEEKDAY_NAMES[weekdayIndex(date)] ?? ''} ${Number(date.slice(8, 10))}. ${month}`;
}

export function bandLabel(band: AgeBand | null): string | null {
	return AGE_BANDS.find((b) => b.key === band)?.label ?? null;
}

/**
 * Titles as people read them: "G7" before "G12", and æ, ø, å after z.
 *
 * Chunks of digits compare as numbers and everything else by code point, with the three
 * Norwegian letters moved past `z` — the whole of what `Intl.Collator('nb', { numeric })` was
 * being used for, without depending on which locales a browser ships.
 */
export function readingOrder(a: string, b: string): number {
	const chunks = (s: string) =>
		s
			.toLowerCase()
			.replace(/æ/g, '{')
			.replace(/ø/g, '|')
			.replace(/å/g, '}')
			.match(/\d+|\D+/g) ?? [];
	const x = chunks(a);
	const y = chunks(b);
	for (let i = 0; i < Math.min(x.length, y.length); i++) {
		const p = x[i] ?? '';
		const q = y[i] ?? '';
		if (p === q) continue;
		const bothNumbers = /^\d/.test(p) && /^\d/.test(q);
		if (bothNumbers) return Number(p) - Number(q);
		return p < q ? -1 : 1;
	}
	return x.length - y.length;
}
