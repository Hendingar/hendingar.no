import { query } from '$app/server';
import { DEFAULT_TIME_ZONE } from '@hendingar/core/datetime';
import { localDayKey } from './calendar.ts';
import { picksFor } from './server/kurator';

/**
 * This weekend's picks, as chosen last night (ADR 0018).
 *
 * A read of stored rows and nothing else — no model runs here, and none can: the choosing happens
 * once a night behind `POST /api/kurator`, which is the whole reason the picks are a table rather
 * than a computation. A page that curated itself on every request would cost a model call per
 * visitor and, worse, could show two readers two different selections of the same weekend.
 *
 * Empty is ordinary and means several different things, none of them an error: no verifier
 * configured, too few events to choose between, nothing the kurator would stand behind, or simply
 * that tonight's run has not happened yet. The page renders the weekend listing either way.
 */
export const weekendPicks = query(async () => {
	return await picksFor(localDayKey(new Date(), DEFAULT_TIME_ZONE));
});
