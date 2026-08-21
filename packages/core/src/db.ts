import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

/**
 * Server-only. Never import this from anything that can reach the client bundle (CLAUDE.md rule 7).
 */
export function createDb(connectionString: string) {
	const client = postgres(connectionString, { max: 10 });
	return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
export { schema };
