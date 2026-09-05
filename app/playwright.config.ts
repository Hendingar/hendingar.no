import { defineConfig } from '@playwright/test';

export default defineConfig({
	// pnpm, not npm — this is a workspace.
	webServer: {
		command: 'pnpm run build && pnpm run preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		// The app validates DATABASE_URL at startup (src/env.ts). E2E doesn't touch the database,
		// but the server still refuses to boot without a well-formed value.
		env: {
			/*
			 * The fallback is a shape, not an address. The local port moves — .env decides it, and
			 * it has been 5433, 55432, 55433 and 5443 — so anything hardcoded here is wrong within
			 * the week. What matters is that startup validation gets something well-formed.
			 */
			DATABASE_URL:
				process.env.DATABASE_URL ?? 'postgres://hendingar:hendingar@localhost:5432/hendingar',
			// A closed port, not empty and not inherited. Set, so the photo tab renders and the
			// two-panel markup is under test; unreachable, so every submission takes the degraded
			// path to the human queue. A developer with a real VERIFIER_URL locally would
			// otherwise get different results from CI.
			VERIFIER_URL: 'http://127.0.0.1:9'
		}
	},
	testDir: 'e2e',
	testMatch: '**/*.e2e.{ts,js}',
	use: { baseURL: 'http://localhost:4173' },
	/*
	 * A bigger budget per assertion on CI, and deliberately NOT retries.
	 *
	 * Four different specs flaked on 2026-09-05 — queue:88, submit:193, submit:166 and ical:18 —
	 * each passing on rerun and each passing locally on repeat. Nothing they assert is wrong; the
	 * five-second default is simply not enough on a shared runner under load, and the specs that
	 * hit it are the ones that wait on a round trip rather than on something already rendered.
	 *
	 * Retries would have made all four green too, and that is exactly why they are not the fix: a
	 * retry turns an intermittent failure into a silent pass, which is how a real intermittent bug
	 * gets shipped. A longer timeout does not make a broken assertion pass — it only stops a slow
	 * machine being reported as a broken one. CLAUDE.md rule 6 is that a flaky test is worse than
	 * no test, because ambiguous failure breaks the whole loop this repo is built around.
	 *
	 * Local runs keep the short default, where a hanging assertion should fail fast.
	 */
	expect: { timeout: process.env.CI ? 15_000 : 5_000 },
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	forbidOnly: !!process.env.CI
});
