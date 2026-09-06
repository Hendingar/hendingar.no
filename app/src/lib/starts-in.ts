/**
 * How many minutes until each row starts, negative once it has begun.
 *
 * Computed on the SERVER, once per request, against one captured instant — never in a component.
 * A tile that read `Date.now()` itself would put one answer in the server-rendered HTML and a
 * different one in the DOM a moment later at hydration, so every near-term row would visibly flip
 * for the reader and a crawler would be served a number that was already wrong. Carried on the
 * row, what is rendered on the server and what the browser ends up with are the same number.
 *
 * One `now` for the whole page, so two events at the same clock time never disagree by a minute
 * because the loop happened to cross a boundary between them.
 *
 * Pure, and its own module rather than a private helper inside one `*.remote.ts`: both
 * `events.remote.ts` and `hearts.remote.ts` return listing rows, and the two must agree on this
 * field or the shared tile cannot rely on it.
 *
 * `formatStartsIn` in `@hendingar/core/datetime` turns the number into words, and decides when it
 * is worth saying anything at all.
 */
export function withStartsIn<Row extends { startsAt: Date; endsAt: Date | null }>(
	rows: Row[],
	now: Date
): (Row & { minutesUntilStart: number | null })[] {
	const ms = now.getTime();
	return rows.map((row) => {
		/*
		 * Null for an event that is over, so the tile says nothing about it.
		 *
		 * Every other listing filters on `or(startsAt >= now, endsAt >= now)`, which makes a
		 * negative number mean "started, still running". `/hjarta` deliberately does NOT: it is the
		 * reader's own saved list and keeps what has already happened, so without this a concert
		 * from March would be labelled "Pågår no" on the one page that shows it.
		 *
		 * An event with no `endsAt` is treated as over once it has started — a 20:00 concert is not
		 * still going at 23:00 just because nobody recorded when it finished.
		 */
		const endsMs = row.endsAt?.getTime() ?? row.startsAt.getTime();
		return {
			...row,
			minutesUntilStart: endsMs < ms ? null : Math.floor((row.startsAt.getTime() - ms) / 60_000)
		};
	});
}
