import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Fetching a URL a stranger typed, without handing them our credentials.
 *
 * This is the dangerous half of the "paste a link" tab. The server makes a request to an address
 * chosen by whoever is submitting, which is server-side request forgery unless it is fenced —
 * and the fence matters more here than in most places, because the app runs on Azure Container
 * Apps with a managed identity. `http://169.254.169.254/metadata/identity/oauth2/token` is a
 * plain HTTP GET from inside the container that returns a real access token for our own
 * subscription. A naive `fetch(userUrl)` hands that to anyone who asks.
 *
 * So: the scheme is restricted, every address the name resolves to is checked against the ranges
 * that are not the public internet, and each redirect hop is checked again — a redirect is the
 * standard way past a check that only looks at the URL somebody typed.
 *
 * What this cannot do is close the gap between the check and the connection. A name that resolves
 * to a public address when we look and a private one when Node connects (DNS rebinding) would slip
 * through. Closing that needs the connection pinned to the address we validated, which Node's
 * fetch does not expose. It is worth knowing about and it is not what this is for: the realistic
 * attack here is `http://169.254.169.254/…` or `http://localhost:5432`, and both are shut.
 */

/** Only schemes a page can actually be served over. `file:` and `gopher:` are not oversights. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Redirect hops. Enough for the http→https→www chain every site has, and no more. */
export const MAX_REDIRECTS = 5;

/** A page, not a download. Anything bigger is not an event listing. */
export const MAX_BYTES = 2 * 1024 * 1024;

/** Total budget, so a server that accepts and then stalls cannot hold a worker open. */
export const TIMEOUT_MS = 10_000;

/**
 * Is this address outside the public internet?
 *
 * Written out rather than pulled from a package: the list is short, it does not change, and a
 * dependency here would be a dependency with a lot of authority.
 */
export function isBlockedAddress(address: string): boolean {
	const version = isIP(address);
	if (version === 4) return isBlockedV4(address);
	if (version === 6) return isBlockedV6(address);
	// Not an address at all. Refuse rather than guess.
	return true;
}

function isBlockedV4(address: string): boolean {
	const parts = address.split('.').map(Number);
	if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
		return true;
	const [a, b] = parts as [number, number, number, number];

	if (a === 0) return true; // 0.0.0.0/8 "this network"
	if (a === 10) return true; // private
	if (a === 127) return true; // loopback
	if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
	if (a === 169 && b === 254) return true; // link-local — this is the cloud metadata endpoint
	if (a === 172 && b >= 16 && b <= 31) return true; // private
	if (a === 192 && b === 0) return true; // IETF protocol assignments, incl. 192.0.0.0/24
	if (a === 192 && b === 168) return true; // private
	if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
	if (a >= 224) return true; // multicast, reserved, broadcast
	return false;
}

function isBlockedV6(address: string): boolean {
	const value = address.toLowerCase().split('%')[0] ?? '';

	if (value === '::' || value === '::1') return true; // unspecified, loopback
	// IPv4 written as IPv6 — ::ffff:127.0.0.1 reaches loopback just as well as 127.0.0.1 does.
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
	if (mapped?.[1]) return isBlockedV4(mapped[1]);
	if (/^::ffff:/.test(value)) return true; // any other v4-mapped form we did not parse

	if (/^f[cd]/.test(value)) return true; // fc00::/7 unique local
	if (/^fe[89ab]/.test(value)) return true; // fe80::/10 link-local
	if (/^ff/.test(value)) return true; // multicast
	if (value.startsWith('2001:db8')) return true; // documentation
	if (value.startsWith('64:ff9b')) return true; // NAT64, a route back to v4
	return false;
}

export type SafeFetchFailure =
	| 'scheme'
	| 'blocked-address'
	| 'unresolvable'
	| 'too-many-redirects'
	| 'too-large'
	| 'not-html'
	| 'unreachable'
	| 'status';

export type SafeFetchResult =
	| { ok: true; url: string; html: string }
	| { ok: false; reason: SafeFetchFailure; status?: number };

/**
 * Every address a hostname resolves to must be allowed, not merely the first.
 *
 * A name with one public and one private answer is a way past a check that stops at `[0]`.
 */
async function hostIsSafe(hostname: string): Promise<boolean> {
	// A literal address needs no lookup — and must not get one, or `dns.lookup` "resolves" it.
	if (isIP(hostname)) return !isBlockedAddress(hostname);

	try {
		const answers = await lookup(hostname, { all: true });
		if (answers.length === 0) return false;
		return answers.every((answer) => !isBlockedAddress(answer.address));
	} catch {
		return false;
	}
}

/**
 * Fetch a page, following redirects by hand so each hop can be checked.
 *
 * `redirect: 'manual'` rather than `'follow'`: letting fetch follow them would validate the URL
 * somebody typed and then quietly request whatever it points at, which is the whole bypass.
 */
export async function fetchPublicPage(rawUrl: string): Promise<SafeFetchResult> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { ok: false, reason: 'scheme' };
	}
	if (!ALLOWED_PROTOCOLS.has(url.protocol)) return { ok: false, reason: 'scheme' };

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
			if (!ALLOWED_PROTOCOLS.has(url.protocol)) return { ok: false, reason: 'scheme' };
			if (!(await hostIsSafe(url.hostname))) return { ok: false, reason: 'blocked-address' };

			let response: Response;
			try {
				response = await fetch(url, {
					redirect: 'manual',
					signal: controller.signal,
					headers: {
						// Say who we are and where to complain. A crawler that hides is a worse citizen
						// than one that identifies itself, and some sites allowlist on this.
						'user-agent': 'hendingar.no/1.0 (+https://hendingar.no/datasamling)',
						accept: 'text/html,application/xhtml+xml'
					}
				});
			} catch {
				return { ok: false, reason: 'unreachable' };
			}

			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get('location');
				if (!location) return { ok: false, reason: 'status', status: response.status };
				try {
					url = new URL(location, url);
				} catch {
					return { ok: false, reason: 'scheme' };
				}
				continue;
			}

			if (!response.ok) return { ok: false, reason: 'status', status: response.status };

			const contentType = response.headers.get('content-type') ?? '';
			if (!/^(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
				return { ok: false, reason: 'not-html' };
			}

			/*
			 * Checked twice, because `content-length` is a claim.
			 *
			 * The header lets an oversized page be refused before it is read; the running total
			 * below is what actually stops one that lied or sent no length at all.
			 */
			const declared = Number(response.headers.get('content-length'));
			if (Number.isFinite(declared) && declared > MAX_BYTES) {
				return { ok: false, reason: 'too-large' };
			}

			const body = response.body;
			if (!body) return { ok: false, reason: 'unreachable' };

			const reader = body.getReader();
			const chunks: Uint8Array[] = [];
			let total = 0;
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					total += value.byteLength;
					if (total > MAX_BYTES) {
						await reader.cancel();
						return { ok: false, reason: 'too-large' };
					}
					chunks.push(value);
				}
			} catch {
				return { ok: false, reason: 'unreachable' };
			}

			const merged = new Uint8Array(total);
			let offset = 0;
			for (const chunk of chunks) {
				merged.set(chunk, offset);
				offset += chunk.byteLength;
			}

			return { ok: true, url: url.href, html: new TextDecoder('utf-8').decode(merged) };
		}

		return { ok: false, reason: 'too-many-redirects' };
	} finally {
		clearTimeout(timer);
	}
}
