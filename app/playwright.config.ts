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
				process.env.DATABASE_URL ?? 'postgres://hendingar:hendingar@localhost:5433/hendingar'
		}
	},
	testMatch: '**/*.e2e.{ts,js}',
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	forbidOnly: !!process.env.CI
});
