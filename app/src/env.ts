import { defineEnvVars } from '@sveltejs/kit/env';
import { z } from 'zod';

/**
 * Environment variables, declared once and validated when the app starts.
 *
 * This is the same principle as everything else here: a missing or malformed DATABASE_URL fails
 * immediately and by name, rather than surfacing as a confusing error on the first query.
 */
export const variables = defineEnvVars({
	DATABASE_URL: {
		schema: z.string().refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
			message: 'DATABASE_URL must be a postgres:// connection string'
		}),
		description: 'Postgres connection string. See .env.example.'
	}
});
