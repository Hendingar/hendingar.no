import { describe, expect, it, vi } from 'vitest';
import { fetchPublicPage, isBlockedAddress, isPublicImage } from './safe-fetch.ts';

/**
 * The address filter is the whole security boundary of the "paste a link" tab, so it is tested as
 * a boundary: named ranges, both address families, and the specific address that would cost us a
 * managed-identity token.
 */
describe('isBlockedAddress', () => {
	it('blocks the cloud metadata endpoint', () => {
		// The reason this file exists. A GET here from inside the container returns an access token
		// for our own Azure subscription.
		expect(isBlockedAddress('169.254.169.254')).toBe(true);
		expect(isBlockedAddress('169.254.0.1')).toBe(true);
		expect(isBlockedAddress('fe80::1')).toBe(true);
	});

	it('blocks loopback and the private ranges', () => {
		for (const address of [
			'127.0.0.1',
			'127.1.2.3',
			'10.0.0.1',
			'172.16.0.1',
			'172.31.255.255',
			'192.168.1.1',
			'0.0.0.0',
			'100.64.0.1',
			'::1',
			'::',
			'fc00::1',
			'fd12:3456::1'
		]) {
			expect(isBlockedAddress(address), address).toBe(true);
		}
	});

	it('blocks IPv4 smuggled inside IPv6', () => {
		// ::ffff:127.0.0.1 reaches loopback exactly as well as 127.0.0.1 does, and a filter that
		// only reads the v6 form as a string does not notice.
		expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
		expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
		expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true);
	});

	it("blocks the less common spellings of v4 inside v6, and Azure's host agent", () => {
		for (const address of [
			'::7f00:1', // ::127.0.0.1, v4-compatible, as Node prints it
			'::127.0.0.1',
			'::ffff:0:7f00:1', // SIIT
			'2002:7f00:1::1', // 6to4 wrapping 127.0.0.1
			'168.63.129.16', // WireServer
			'203.0.113.7',
			'198.51.100.7'
		]) {
			expect(isBlockedAddress(address), address).toBe(true);
		}
		// And an ordinary public address of each family still passes.
		expect(isBlockedAddress('93.184.216.34')).toBe(false);
		expect(isBlockedAddress('2a00:1450:400f:80d::200e')).toBe(false);
	});

	it('blocks multicast, broadcast and reserved space', () => {
		for (const address of ['224.0.0.1', '239.1.1.1', '255.255.255.255', 'ff02::1']) {
			expect(isBlockedAddress(address), address).toBe(true);
		}
	});

	it('refuses anything that is not an address at all, rather than guessing', () => {
		for (const value of ['', 'localhost', 'not-an-address', '999.1.1.1', '10.0.0']) {
			expect(isBlockedAddress(value), value).toBe(true);
		}
	});

	it('allows ordinary public addresses', () => {
		for (const address of ['1.1.1.1', '93.184.216.34', '8.8.8.8', '2606:4700::1111']) {
			expect(isBlockedAddress(address), address).toBe(false);
		}
	});
});

describe('fetchPublicPage', () => {
	/*
	 * Hermetic: every case here is refused before a socket is opened, so no test touches the
	 * network. The cases that would require a server are covered by the address filter above.
	 */
	it('refuses a scheme that is not http or https', async () => {
		for (const url of [
			'file:///etc/passwd',
			'gopher://x',
			'javascript:alert(1)',
			'data:text/html,x'
		]) {
			expect((await fetchPublicPage(url)).ok, url).toBe(false);
		}
	});

	it('refuses a literal private address without asking DNS', async () => {
		for (const url of [
			'http://169.254.169.254/metadata/identity/oauth2/token',
			'http://127.0.0.1:5432/',
			'http://[::1]:5173/',
			'http://10.0.0.5/admin'
		]) {
			const result = await fetchPublicPage(url);
			expect(result.ok, url).toBe(false);
			if (!result.ok) expect(result.reason).toBe('blocked-address');
		}
	});

	it('refuses a hostname that does not resolve', async () => {
		const result = await fetchPublicPage('http://ikkje-eit-domene-som-finst.invalid/');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('blocked-address');
	});

	it('refuses a URL it cannot even parse', async () => {
		const result = await fetchPublicPage('ikkje ei lenkje');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('scheme');
	});
});

describe('isPublicImage', () => {
	/*
	 * Hermetic for the same reason as above: every case here is refused before a socket opens. The
	 * content-type half needs a server and is covered by the submit path's own probe at runtime.
	 */
	it('refuses anything that is not an http(s) address', async () => {
		for (const url of [
			'file:///etc/passwd',
			'data:image/png;base64,AA',
			'javascript:alert(1)',
			'nonsense'
		]) {
			expect(await isPublicImage(url), url).toBe(false);
		}
	});

	it('refuses a private address, so a posted URL cannot probe from inside', async () => {
		/*
		 * The reason this is re-checked at submit time at all: the field travels through a browser,
		 * and a browser can post anything. `169.254.169.254` is the one that matters — an image URL
		 * is a fetch our server makes, and that address is the managed identity's token endpoint.
		 */
		for (const url of [
			'http://169.254.169.254/metadata/identity/oauth2/token',
			'http://127.0.0.1:5432/x.png',
			'http://[::1]:5173/x.png',
			'http://10.0.0.5/logo.png'
		]) {
			expect(await isPublicImage(url), url).toBe(false);
		}
	});

	it('never follows a redirect to a private address', async () => {
		/*
		 * A public address that 302s inside. The fetch is stubbed, so no socket opens; what is
		 * asserted is that the second hop is refused before it is requested — one call, not two.
		 * An IP literal so the first hop's check needs no DNS.
		 */
		const asked: string[] = [];
		vi.stubGlobal('fetch', async (input: URL | string, init?: RequestInit) => {
			// `follow` would hand the next hop to fetch, which requests it unchecked.
			expect(init?.redirect).toBe('manual');
			asked.push(String(input));
			return new Response(null, {
				status: 302,
				headers: { location: 'http://127.0.0.1:8080/x.png' }
			});
		});
		try {
			expect(await isPublicImage('http://93.184.216.34/poster.jpg')).toBe(false);
			expect(asked).toEqual(['http://93.184.216.34/poster.jpg']);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
