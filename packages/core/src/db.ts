import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

/**
 * Server-only. Never import this from anything that can reach the client bundle (CLAUDE.md rule 7).
 */
export function createDb(connectionString: string) {
	const client = postgres(connectionString, {
		/*
		 * Sized against the smallest server we run. Azure Postgres B1ms caps max_connections at 35
		 * (3 reserved). Container Apps runs old and new revisions concurrently during a rollout, so
		 * the worst case is 2 old + 2 new replicas plus the CI migration connection. At the
		 * postgres.js default of 10 that is 41 sockets against a 32-connection budget, and requests
		 * fail with `53300 remaining connection slots are reserved`.
		 */
		max: 5,
		/* postgres.js defaults to null — idle sockets are never returned. That is what turns a
		 * traffic spike into a permanent connection leak. */
		idle_timeout: 20,
		connect_timeout: 10
	});
	return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
export { schema };
