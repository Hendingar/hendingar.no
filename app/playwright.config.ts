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
			// Pinned empty, not inherited: the submission specs assert both the no-verifier UI and
			// the degraded verdict. A developer with VERIFIER_URL set locally would otherwise get
			// different results from CI.
			VERIFIER_URL: ''
		}
	},
	testDir: 'e2e',
	testMatch: '**/*.e2e.{ts,js}',
	use: { baseURL: 'http://localhost:4173' },
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	forbidOnly: !!process.env.CI
});
