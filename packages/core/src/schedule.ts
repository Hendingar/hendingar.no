/**
 * Minimal cron support, for showing people when a source is next collected.
 *
 * Deliberately handles only `M H * * *` — a daily run at a fixed UTC time — which is the only
 * shape our scheduled jobs use. A full cron parser is a dependency and a class of bugs we have no
 * reason to take on; an unsupported expression returns null and the UI says so rather than
 * inventing a time.
 */

const DAILY = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/;

export function describeCron(cron: string | null | undefined): string | null {
	if (!cron) return null;
	const m = DAILY.exec(cron.trim());
	if (!m) return null;
	const minute = Number(m[1]);
	const hour = Number(m[2]);
	if (hour > 23 || minute > 59) return null;
	return `dagleg ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} UTC`;
}

/** Next occurrence strictly after `from`, or null for an expression we do not support. */
export function nextCronRun(cron: string | null | undefined, from: Date): Date | null {
	if (!cron) return null;
	const m = DAILY.exec(cron.trim());
	if (!m) return null;
	const minute = Number(m[1]);
	const hour = Number(m[2]);
	if (hour > 23 || minute > 59) return null;

	const next = new Date(
		Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, minute, 0, 0)
	);
	if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
	return next;
}

/** Coarse, human-facing freshness. Anything past two missed runs is stale. */
export function freshness(
	lastRunAt: Date | null | undefined,
	cron: string | null | undefined,
	now: Date
): 'fresh' | 'late' | 'stale' | 'never' {
	if (!lastRunAt) return 'never';
	const ageMs = now.getTime() - lastRunAt.getTime();
	const dayMs = 24 * 60 * 60 * 1000;
	if (!cron) return ageMs < 7 * dayMs ? 'fresh' : 'stale';
	if (ageMs <= dayMs * 1.25) return 'fresh';
	if (ageMs <= dayMs * 2.25) return 'late';
	return 'stale';
}
