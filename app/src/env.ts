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
	},
	/**
	 * Base URL of the verifier microservice (services/verifier). In Azure this is the Container
	 * Apps internal DNS name, reachable only from inside the environment.
	 *
	 * Optional by design: without it, photo extraction and agentic verification are disabled and
	 * the site says so plainly rather than failing. A contributor must be able to run the whole
	 * app without any AI credentials, and the submission form still works.
	 */
	VERIFIER_URL: {
		schema: (value) => value || undefined,
		description: 'Base URL of the verifier service. Optional; features degrade without it.'
	}
});
