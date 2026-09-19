import { defineConfig } from '@playwright/test';

/*
 * Playwright is plain Node — nothing here has read the repo's .env, which is why DATABASE_URL had
 * to be exported by hand or the suite booted the app against a database that does not exist. Load
 * it, with the same precedence as `node --env-file` and as the importer CLIs: an exported value
 * still wins, so a scratch database can be pointed at from the command line. Resolved against this
 * file, not the cwd, and absent in CI — where the environment supplies everything.
 */
try {
	process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
	// No .env: CI, or a checkout that has not run setup yet. The fallbacks below still apply.
}

/*
 * 4173 everywhere except a git worktree, where `.superset/setup.sh` writes an E2E_PORT into .env
 * and every worktree gets its own. Two suites on one machine otherwise fight over the port: with
 * CI set the second one cannot bind it, and without CI `reuseExistingServer` quietly attaches to
 * the first one's build, serving the first one's database. That cost a week of ambiguous failures
 * once already. CI has no .env and no E2E_PORT, so it stays on 4173.
 */
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
	// pnpm, not npm — this is a workspace.
	webServer: {
		// `pnpm exec vite preview`, not `pnpm run preview --port …`: pnpm passes the separator
		// through to the script, and vite silently ignores everything after it — so the port flag
		// never arrives and the suite waits out its timeout against an empty port.
		command: `pnpm run build && pnpm exec vite preview --port ${port} --strictPort`,
		port,
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
	use: { baseURL: `http://localhost:${port}` },
	/*
	 * A bigger budget per assertion on CI, and deliberately NOT retries.
	 *
	 * Read the history here, because it is the whole argument for rule 6. A run of specs kept
	 * timing out waiting for `.verdict` — queue:88, submit:193, submit:166, ical:18, and later
	 * four more — always that shape and never the same spec twice. This budget was raised from
	 * five seconds to fifteen to absorb it, on the theory that a shared runner under load was
	 * simply slow. It came back, because that theory was wrong: the submissions were not slow,
	 * they were never made. Hydration was erasing the fields the spec had just typed, the browser
	 * refused to submit an empty required title, and no request was ever sent — so no timeout,
	 * however long, could have gone green. See `src/lib/typed-before-hydration.ts`, which fixes it.
	 *
	 * Retries would have made every one of them green too, and that is exactly why they are not
	 * the fix: a retry turns an intermittent failure into a silent pass, which is how a real
	 * intermittent bug — this one, in the submission form people actually use — gets shipped.
	 *
	 * The budget stays where it is: a loaded runner is genuinely slower (the suite takes twice as
	 * long at two workers as at five), and nothing here now depends on it to pass. Local runs keep
	 * the short default, where a hanging assertion should fail fast.
	 */
	expect: { timeout: process.env.CI ? 15_000 : 5_000 },
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	forbidOnly: !!process.env.CI
});
