import { weekendAhead } from '@hendingar/core/datetime';

/**
 * Which stored picks a reader should be shown, given everything that has ever been chosen.
 *
 * Pure, and separated from the query for one reason: this is the part that was wrong in
 * production. The first version read the selection stored under *today's* date, which is a
 * different thing from "the selection that stands" — the rows are keyed by the day the nightly job
 * ran, and that job is a GitHub `schedule`, nominally 05:00 UTC and in practice landing nearer
 * 10:00. So between midnight and lunchtime there was no row for today and the section vanished,
 * every day, from the page whose whole question is "is anything worth going out for this weekend".
 *
 * Two rules, and neither is a clock:
 *
 * 1. **The newest selection stands.** Not today's — the newest one made on or before today. A day
 *    when nothing ran shows yesterday's answer, which is still a true answer about the same
 *    weekend.
 * 2. **A pick retires with its weekend.** Every pick is checked against `weekendAhead`, so a
 *    selection made on Monday loses its Friday pick once Friday is over and empties by itself when
 *    the weekend has been and gone. Nothing has to run for that to happen, which is the property
 *    worth having: the page is correct on a day the job never fires at all.
 */
export type StoredPick = {
	/** The day the selection was made. Several picks share one. */
	forDate: string;
	/** The picked event's own day, at its own venue. `YYYY-MM-DD`. */
	localDate: string;
};

export function currentSelection<T extends StoredPick>(picks: readonly T[], today: string): T[] {
	const dates = weekendAhead(today);

	/*
	 * String comparison is date comparison for `YYYY-MM-DD`, which is what the format is for — and
	 * it keeps this free of a clock, so a test can ask about any morning it likes.
	 */
	const newest = picks
		.filter((pick) => pick.forDate <= today)
		.reduce<string | null>(
			(latest, pick) => (latest === null || pick.forDate > latest ? pick.forDate : latest),
			null
		);
	if (newest === null) return [];

	return picks.filter((pick) => pick.forDate === newest && dates.includes(pick.localDate));
}
