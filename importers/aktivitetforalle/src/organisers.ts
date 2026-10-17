import { z } from 'zod';
import { orNull, type UpstreamEvent } from './api.ts';

/**
 * Who publishes on the portal by hand — a report, not part of the import.
 *
 * Most of Stord's portal is eBillett's kulturhus programme mirrored in, and we collect that
 * directly. The rows with no `event_external_provider` are the other kind: a club, a choir, the
 * kulturskule typing in its own season. This lists those organisers with how many rows each has,
 * to see which local groups the portal already brings us.
 *
 * Pure. `organisers-report.ts` is the I/O around it.
 */

const organizerRowSchema = z.object({
	organizer_id: z.union([z.string(), z.number()]),
	/** The name the portal shows a reader. See `parseOrganizers` in api.ts for why not `organizer_name`. */
	organizer_title: z.preprocess(orNull, z.string().nullable()),
	organizer_public: z.boolean().nullish()
});

export type OrganizerRow = z.infer<typeof organizerRowSchema>;

/** `/api/v1/organizers` → every row, public or not. The report decides what to name. */
export function parseOrganizerRows(body: unknown): OrganizerRow[] {
	const data = z.object({ data: z.array(z.unknown()).nullish() }).parse(body).data ?? [];
	return data.flatMap((raw) => {
		const parsed = organizerRowSchema.safeParse(raw);
		return parsed.success ? [parsed.data] : [];
	});
}

export type OrganiserCount = {
	/** The portal's id, or null when the row named its organiser only as free text. */
	organizerId: string | null;
	name: string;
	/** Rows of each kind. A weekly `activity` is one row however often it meets. */
	activities: number;
	arrangements: number;
	total: number;
};

/**
 * Hand-entered public rows, grouped by organiser, most rows first.
 *
 * Public only: an archived row is a past season, and "covered" means the portal is publishing it
 * now. An organiser the portal marks not public is listed by id and not by name — for a few of them
 * the account name is the private person who registered it.
 */
export function organisersOfHandEnteredEvents(
	events: readonly UpstreamEvent[],
	organizers: readonly OrganizerRow[]
): OrganiserCount[] {
	const byId = new Map(organizers.map((o) => [String(o.organizer_id), o]));
	const counts = new Map<string, OrganiserCount>();

	for (const event of events) {
		if (orNull(event.event_status) !== 'public') continue;
		if (orNull(event.event_external_provider) !== null) continue;

		const id = event.organizer_id != null ? String(event.organizer_id) : null;
		const organizer = id ? byId.get(id) : undefined;
		const name =
			organizer && organizer.organizer_public !== false && organizer.organizer_title
				? organizer.organizer_title
				: id
					? `(organiser ${id}, no public name)`
					: (orNull(event.event_organizer_name) ?? '(no organiser given)');

		const key = id ? `id:${id}` : `name:${name}`;
		const entry = counts.get(key) ?? {
			organizerId: id,
			name,
			activities: 0,
			arrangements: 0,
			total: 0
		};
		if (orNull(event.event_type) === 'activity') entry.activities += 1;
		else entry.arrangements += 1;
		entry.total += 1;
		counts.set(key, entry);
	}

	return [...counts.values()].sort(
		(a, b) => b.total - a.total || a.name.localeCompare(b.name, 'nb')
	);
}
