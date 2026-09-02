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
			DATABASE_URL:
				process.env.DATABASE_URL ?? 'postgres://hendingar:hendingar@localhost:5433/hendingar',
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
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	forbidOnly: !!process.env.CI
});
