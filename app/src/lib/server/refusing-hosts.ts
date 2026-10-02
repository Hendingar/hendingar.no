import type { SafeFetchFailure } from './safe-fetch.ts';

/**
 * Sites that serve people and refuse servers.
 *
 * Bandsintown answers with a Cloudflare 403 — not a redirect, not a login wall, a flat refusal of
 * anything that is not a browser. Measured four ways before this was written: with our own user
 * agent, with a browser's, with a real headless Chromium, and from the deployed app in Azure. All
 * 403, including `robots.txt` itself, so we cannot even read what they would permit.
 *
 * No code fixes that, and nothing here tries. The generic "nettstaden ville ikkje gje oss sida"
 * is accurate and leaves somebody pressing the button a second time, so the hosts we know about
 * say what actually works instead — which is the photo path, and that one brings the picture with
 * it, which the link never would have.
 *
 * **This is an explanation, not a workaround.** If a site is added here, it is because we have
 * established that it will not serve us and we are telling the reader so.
 */
const REFUSES_SERVERS: readonly { host: RegExp; name: string }[] = [
	{ host: /(^|\.)bandsintown\.com$/i, name: 'Bandsintown' }
];

/**
 * The message for a host we know refuses us, or null to use the generic one.
 *
 * `photoAvailable` is the verifier: a page that says "photograph it instead" when nothing can read
 * a photograph is the broken promise rule 8 is about, so the advice changes rather than the
 * explanation.
 */
export function refusedByHost(
	rawUrl: string,
	reason: SafeFetchFailure,
	photoAvailable: boolean
): string | null {
	// Only for a refusal. A typo in the domain, or a link to a PDF, is not this.
	if (reason !== 'status' && reason !== 'unreachable') return null;

	let host: string;
	try {
		host = new URL(rawUrl).hostname;
	} catch {
		return null;
	}

	const known = REFUSES_SERVERS.find((site) => site.host.test(host));
	if (!known) return null;

	return photoAvailable
		? `${known.name} slepp ikkje serverar inn, så vi får aldri sjå sida. Ta eit skjermbilete av ` +
				'hendinga og slepp det i biletboksen under — då les vi det derifrå, og biletet blir med. ' +
				'Lenkja tek vi vare på.'
		: `${known.name} slepp ikkje serverar inn, så vi får aldri sjå sida. Fyll inn skjemaet under ` +
				'— lenkja er teken vare på.';
}
