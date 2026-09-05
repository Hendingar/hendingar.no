import { describe, expect, it } from 'vitest';
import { fetchPublicPage, isBlockedAddress } from './safe-fetch.ts';

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
