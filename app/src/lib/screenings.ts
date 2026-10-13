/**
 * A film's screenings, as days with times under them.
 *
 * Pure: the rows arrive with their calendar day already resolved at the venue (in SQL, like every
 * day grouping on this site), so nothing here reads a clock or derives a day from an instant.
 */
export type Screening = {
	id: number;
	startsAt: Date;
	venueName: string | null;
	venueTimeZone: string | null;
	/** `YYYY-MM-DD` at the venue. */
	localDate: string;
};

export type ScreeningDay = { localDate: string; screenings: Screening[] };

/** Days in date order, times in time order within each. */
export function screeningDays(screenings: readonly Screening[]): ScreeningDay[] {
	const sorted = [...screenings].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
	const days: ScreeningDay[] = [];
	for (const screening of sorted) {
		const last = days.at(-1);
		if (last?.localDate === screening.localDate) last.screenings.push(screening);
		else days.push({ localDate: screening.localDate, screenings: [screening] });
	}
	return days;
}

/**
 * Whether a time needs its screen named beside it.
 *
 * Stord kino runs one film in both Storsalen and Småsalen in the same week. Naming the room on
 * every time when there is only one is noise; omitting it when there are two sends somebody to
 * the wrong door.
 */
export function showsInSeveralRooms(screenings: readonly Screening[]): boolean {
	return new Set(screenings.map((s) => s.venueName)).size > 1;
}
