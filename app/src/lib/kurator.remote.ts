import { query } from '$app/server';
import { currentPicks } from './server/kurator';

/**
 * This weekend's picks, as chosen last night (ADR 0018).
 *
 * A read of stored rows and nothing else — no model runs here, and none can: the choosing happens
 * once a night behind `POST /api/kurator`, which is the whole reason the picks are a table rather
 * than a computation. A page that curated itself on every request would cost a model call per
 * visitor and, worse, could show two readers two different selections of the same weekend.
 *
 * The newest selection stands until a newer one replaces it or the weekend it is about has passed —
 * it is emphatically NOT "what was chosen today". Reading by today's date left the section empty
 * every morning until the nightly job landed, which on a best-effort `schedule` is nearer noon than
 * dawn. See `currentPicks`.
 *
 * Empty is ordinary and means several different things, none of them an error: no verifier
 * configured, too few events to choose between, nothing the kurator would stand behind, or a
 * weekend that has been and gone. The page renders the weekend listing either way.
 */
export const weekendPicks = query(async () => {
	return await currentPicks();
});
