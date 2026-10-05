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
		/*
		 * The reason goes to the log, not the body. This route is public, and a driver's message
		 * names the database host, the user and sometimes the network path to them — a map for
		 * anybody who polls it during an outage.
		 */
		console.error(
			`[health] database unreachable: ${error instanceof Error ? error.message : error}`
		);
		return new Response(JSON.stringify({ status: 'degraded', database: 'unreachable' }), {
			status: 503,
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
		});
	}
}
