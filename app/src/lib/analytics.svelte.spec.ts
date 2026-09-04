import { describe, expect, it, vi } from 'vitest';
import { startAnalytics } from './analytics.ts';

/**
 * Whether the tracker actually starts, in a real browser, with the network stubbed.
 *
 * `shouldTrack` is pure and covered under node. What this adds is the half that cannot be reasoned
 * about: that a live hostname really does install the tracker and configure it against our own
 * collector, and that a development one really does not — without sending a beacon to anybody in
 * order to prove it.
 *
 * `startAnalytics` installs at most once per page, so that latch is module state that no
 * `resetModules` reaches here. Exactly one test may therefore use the live hostname; the rest use
 * development ones, which return before touching the latch. Two live tests would pass or fail on
 * the order they happened to run in.
 */
const installD8a = vi.fn(() => {
	// The real one defines this global; the module reads it back and gives up quietly without it.
	(window as unknown as { d8a?: unknown }).d8a = d8a;
});

const d8a = vi.fn();

vi.mock('@d8a-tech/wt', () => ({ installD8a }));

describe('startAnalytics', () => {
	it('installs once on the live site and points it at our collector', async () => {
		// Three calls, because the layout effect can re-run: a second install double-counts everyone.
		await startAnalytics('hendingar.no');
		await startAnalytics('hendingar.no');
		await startAnalytics('hendingar.no');

		expect(installD8a).toHaveBeenCalledTimes(1);
		expect(d8a).toHaveBeenCalledWith('js', expect.any(Date));
		const config = d8a.mock.calls.find((call) => call[0] === 'config');
		expect(config?.[1]).toBe('05801cfd-cf47-4892-9a2a-b301f6b2c429');
		expect(config?.[2]).toEqual({
			server_container_url: 'https://global.t.d8a.tech/05801cfd-cf47-4892-9a2a-b301f6b2c429/d/c'
		});
	});

	it('does nothing at all from a development host', async () => {
		/*
		 * Not merely "sends no events" — the dependency is never even imported, so a reader on
		 * localhost, on a preview build, or in any end-to-end run downloads nothing and is told
		 * nothing. The assertion is on the install because that is the observable difference.
		 */
		const before = installD8a.mock.calls.length;
		for (const host of ['localhost', '127.0.0.1', 'app.internal.azurecontainerapps.io']) {
			await startAnalytics(host);
		}
		expect(installD8a.mock.calls.length).toBe(before);
	});
});
