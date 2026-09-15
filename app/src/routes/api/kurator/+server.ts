import { json } from '@sveltejs/kit';
import { curateToday } from '../../../lib/server/kurator';
import type { RequestHandler } from './$types';

/**
 * The nightly curation, triggered from outside and performed inside.
 *
 * This endpoint exists because of where the verifier is. It is the only place a model may run
 * (ADR 0008) and its ingress is internal — `infra/verifier.bicep`, `external: false` — so that an
 * unauthenticated `/extract` on a public URL cannot become a free vision-model proxy. The nightly
 * job is a GitHub runner, which reaches Postgres through a firewall rule it opens around itself and
 * has no route into the Container Apps environment at all. Something inside that environment has to
 * place the call. The app already is that something.
 *
 * **Why it can be open.** It takes no input and is idempotent per day: the second call finds the
 * stored rows and returns them without asking a model anything. So the ceiling is one curation a
 * night regardless of who finds the URL — and because the selection depends on the date rather than
 * on the caller, a stranger who triggers it gets the picks the cron would have produced anyway,
 * only earlier. There is nothing here to steal and nothing to steer, which is what makes it a
 * different animal from the proxy ADR 0008 refused. ADR 0018 states that argument in full.
 *
 * `POST` rather than `GET`, and that distinction is doing real work: this writes rows, and a `GET`
 * that writes is one crawler away from being run every hour.
 */
export const POST: RequestHandler = async () => {
	const outcome = await curateToday();
	return json(outcome, { headers: { 'cache-control': 'no-store' } });
};
