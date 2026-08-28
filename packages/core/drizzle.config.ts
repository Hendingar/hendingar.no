import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

// Node built-in; no dotenv dependency. `pnpm db:up` creates .env from .env.example.
// fileURLToPath, not URL.pathname — pathname is percent-encoded, so a checkout under
// "~/Dev Projects/" or any path containing å resolves to a file that doesn't exist, and the
// catch below turns that into a misleading "DATABASE_URL is not set".
try {
	process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
	// no .env — fall through to the check below, which reports it properly
}

const url = process.env.DATABASE_URL;
if (!url) {
	throw new Error('DATABASE_URL is not set. Run `pnpm db:up` (it creates .env from .env.example).');
}

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/schema.ts',
	out: './migrations',
	dbCredentials: { url },
	strict: true,
	verbose: true
});
