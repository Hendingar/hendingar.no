/**
 * Token buckets, one per key, refilled continuously.
 *
 * Its own module, with no environment and no clock of its own, so the rules can be tested as rules
 * — the same split `pile-answer.ts` makes for its `Budget`. The policies, and the wiring to the
 * request, are in `limits.ts`.
 *
 * **Per replica, in memory, and that is a choice.** The app runs one to three replicas
 * (infra/app.bicep), so every ceiling here is really "this, up to three times". That is still a
 * ceiling — which is the whole job: the worry is somebody scripting an endpoint to run up a model
 * bill or fill the queue with junk, not a careful distributed attacker. A table in Postgres would be
 * exact, and would cost a write on every request to defend against a hypothetical. A restart
 * forgets everything, which errs towards letting people in.
 */
export class RateLimiter {
	readonly #buckets = new Map<string, { tokens: number; at: number }>();

	/**
	 * @param capacity how many in a burst, and how many per `periodMs` sustained.
	 * @param periodMs how long an empty bucket takes to fill again.
	 * @param maxKeys a bound on memory. Somebody rotating addresses must not be able to grow the
	 *   map without limit; past this the least recently seen key is forgotten, which hands that
	 *   key a fresh bucket — a leak of a few requests, never of memory.
	 */
	constructor(
		readonly capacity: number,
		readonly periodMs: number,
		readonly maxKeys = 10_000
	) {}

	/** Spend one for `key`. False, and nothing spent, when its bucket is empty. */
	take(key: string, now: number): boolean {
		const bucket = this.#buckets.get(key);
		const elapsed = bucket ? Math.max(0, now - bucket.at) : 0;
		const tokens = bucket
			? Math.min(this.capacity, bucket.tokens + (elapsed / this.periodMs) * this.capacity)
			: this.capacity;

		// Re-insert so the Map's insertion order is recency order, and eviction takes the oldest.
		this.#buckets.delete(key);
		if (tokens < 1) {
			this.#buckets.set(key, { tokens, at: now });
			return false;
		}
		this.#buckets.set(key, { tokens: tokens - 1, at: now });

		while (this.#buckets.size > this.maxKeys) {
			const oldest = this.#buckets.keys().next().value;
			if (oldest === undefined) break;
			this.#buckets.delete(oldest);
		}
		return true;
	}
}

/**
 * An address as a rate-limit key: IPv4 as itself, IPv6 by its /64.
 *
 * One home connection is routinely handed a whole /64, so keying on the full IPv6 address would let
 * one machine be eighteen quintillion visitors.
 */
export function networkOf(address: string): string {
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
	if (mapped) return mapped[1];
	if (!address.includes(':')) return address;

	const [head, tail = ''] = address.split('::');
	const left = head ? head.split(':') : [];
	const right = tail ? tail.split(':') : [];
	const groups = address.includes('::')
		? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
		: left;
	return `${groups
		.slice(0, 4)
		.map((g) => (g || '0').toLowerCase().replace(/^0+(?=.)/, ''))
		.join(':')}::/64`;
}
