import { describe, expect, it } from 'vitest';
import { refusedByHost } from './refusing-hosts.ts';

describe('refusedByHost', () => {
	it('names what to do instead for a host that will not serve a server', () => {
		const message = refusedByHost('https://www.bandsintown.com/e/108980821', 'status', true);
		expect(message).toContain('Bandsintown');
		expect(message).toMatch(/skjermbilete/);
		// And the link survives the disappointment, which is the whole promise of the failure path.
		expect(message).toMatch(/Lenkja tek vi vare på/);
	});

	it('does not offer the photo box when nothing can read a photo', () => {
		// Rule 8: never a button that cannot work. Without the verifier the explanation stands and
		// the advice changes.
		const message = refusedByHost('https://bandsintown.com/e/1', 'status', false);
		expect(message).toContain('Bandsintown');
		expect(message).not.toMatch(/skjermbilete/);
	});

	it('matches the host and its subdomains, never a lookalike', () => {
		expect(refusedByHost('https://bandsintown.com.evil.no/e/1', 'status', true)).toBeNull();
		expect(refusedByHost('https://notbandsintown.com/e/1', 'status', true)).toBeNull();
	});

	it('stays out of the way of every other failure', () => {
		/*
		 * A typo in the domain, a link to a PDF, or a page too big to read are all ordinary
		 * failures with their own wording. Only a refusal gets this.
		 */
		for (const reason of ['not-html', 'too-large', 'scheme', 'blocked-address'] as const) {
			expect(refusedByHost('https://www.bandsintown.com/e/1', reason, true), reason).toBeNull();
		}
	});

	it('is null for every host we have not established this about', () => {
		expect(refusedByHost('https://doemes.no/program', 'status', true)).toBeNull();
		expect(refusedByHost('not a url', 'status', true)).toBeNull();
	});
});
