import { z } from 'zod';
import { scheduleUrl, teamUrl, type HandballTeam } from './teams.ts';

/**
 * Reading one team's season from handball.no. Two requests: the team page, then its schedule.
 *
 * ## Why the page first
 *
 * The schedule endpoint needs a `seasonId`, and without one it answers an empty list — it does
 * not default to the current season. The id changes every autumn (201068 is 2026/2027), so a
 * constant here would import nothing from next August and report it as success. The team page
 * names the season it is showing in the URL it hands its own schedule widget, so we read it from
 * there, every run.
 *
 * ## Why the extra header
 *
 * Without `X-Requested-With: XMLHttpRequest` the endpoint answers 405. It is what the page's own
 * script sends, and we send it for the same request.
 *
 * Permission to read `/api/` is recorded in teams.ts.
 */

const HEADERS = {
	// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
	'user-agent': 'hendingar.no importer (+https://hendingar.no)'
};

/**
 * The season id, out of the URL the team page gives its "Terminliste" widget.
 *
 * In the markup the `&` is JSON-escaped as `&`, so the pattern accepts either.
 */
export function seasonIdFrom(html: string, team: HandballTeam): number | null {
	const pattern = new RegExp(
		`TerminListeForTeam\\?id=${team.teamId}(?:&|\\\\u0026|&amp;)seasonId=(\\d+)`
	);
	const id = pattern.exec(html)?.[1];
	return id ? Number(id) : null;
}

/** `"2026-10-17T00:00:00"` — a calendar date dressed as a timestamp. Only the date is meant. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

/**
 * One match, with the fields we read.
 *
 * `passthrough` is absent on purpose: a row carries forty fields (referee tasks, organiser ids,
 * booking flags) and naming only what we use keeps the mapper honest about what it knows.
 */
const matchSchema = z.object({
	matchId: z.number().int().positive(),
	tournamentName: z.string().nullish(),
	roundName: z.string().nullish(),
	homeTeamId: z.number().int(),
	awayTeamId: z.number().int(),
	homeTeamName: z.string().min(1),
	awayTeamName: z.string().min(1),
	homeTeamShortName: z.string().nullish(),
	awayTeamShortName: z.string().nullish(),
	matchDate: day,
	/** Wall clock as an integer, `1600` for 16:00. Null for a match not yet given a time. */
	matchStartTime: z.number().int().nullish(),
	matchEndTime: z.number().int().nullish(),
	venueUnitId: z.number().int().nullish(),
	venueUnitName: z.string().nullish(),
	postponed: z.boolean().nullish(),
	cancelled: z.boolean().nullish(),
	matchStream: z.object({ streamText: z.string().nullish() }).nullish()
});

export type RawMatch = z.infer<typeof matchSchema>;

const scheduleSchema = z.object({ matches: z.array(z.unknown()) });

export type ParsedSchedule = { matches: RawMatch[]; rejected: string[] };

/**
 * The schedule, row by row. A row that changed shape is reported and skipped, never fatal: one
 * odd match must not cost the season. A body that is not a schedule at all is fatal.
 */
export function parseSchedule(body: unknown): ParsedSchedule {
	const outer = scheduleSchema.safeParse(body);
	if (!outer.success) throw new Error(`not a schedule: ${outer.error.issues[0]?.message}`);
	const matches: RawMatch[] = [];
	const rejected: string[] = [];
	for (const row of outer.data.matches) {
		const parsed = matchSchema.safeParse(row);
		if (parsed.success) matches.push(parsed.data);
		else
			rejected.push(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)[0] ?? '');
	}
	return { matches, rejected };
}

export type ReadSchedule = (team: HandballTeam) => Promise<ParsedSchedule>;

async function get(url: string, headers: Record<string, string>): Promise<Response> {
	const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response;
}

export const readSchedule: ReadSchedule = async (team) => {
	const page = await (await get(teamUrl(team), { ...HEADERS, accept: 'text/html' })).text();
	const seasonId = seasonIdFrom(page, team);
	/*
	 * No season, no import. A redesigned page that stops naming one must fail by name here rather
	 * than fetch nothing and report an empty, healthy source.
	 */
	if (!seasonId) throw new Error(`${teamUrl(team)} names no season`);
	const response = await get(scheduleUrl(team, seasonId), {
		...HEADERS,
		accept: 'application/json',
		'x-requested-with': 'XMLHttpRequest'
	});
	return parseSchedule(await response.json());
};
