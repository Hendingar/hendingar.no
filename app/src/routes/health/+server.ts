import { sql } from 'drizzle-orm';
import { db } from '../../lib/server/db';

/**
 * Liveness + database readiness.
 *
 * This exists because a 200 on `/` proved nothing: the app serves the page fine with the database
 * unreachable, so the deploy smoke test was a false green — a wrong password or a firewall change
 * shipped as "success". This endpoint fails loudly instead.
 */
export async function GET() {
	try {
		await db().execute(sql`select 1`);
		return new Response(JSON.stringify({ status: 'ok', database: 'ok' }), {
			status: 200,
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
		});
	} catch (error) {
		return new Response(
			JSON.stringify({
				status: 'degraded',
				database: 'unreachable',
				error: error instanceof Error ? error.message : 'unknown'
			}),
			{
				status: 503,
				headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
			}
		);
	}
}
