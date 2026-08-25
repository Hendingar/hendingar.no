import { defineConfig } from 'drizzle-kit';

// Node 26 built-in; no dotenv dependency. `pnpm db:up` creates .env from .env.example.
try {
	process.loadEnvFile(new URL('../../.env', import.meta.url).pathname);
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
