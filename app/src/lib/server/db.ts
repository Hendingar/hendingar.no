import { DATABASE_URL } from '$app/env/private';
import { createDb, type Db } from '@hendingar/core/db';

/**
 * Server-only. `$lib/server/**` cannot be imported from client code, and remote functions are
 * forbidden from living in this directory — exactly the guarantee we want around a DB client.
 *
 * DATABASE_URL is validated at startup by src/env.ts, so it is a checked string here, not a
 * `string | undefined` we have to guard.
 */
let instance: Db | undefined;

export function db(): Db {
	instance ??= createDb(DATABASE_URL);
	return instance;
}
