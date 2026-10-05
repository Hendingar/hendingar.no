import { describe, expect, it } from 'vitest';
import { RateLimiter, networkOf } from './rate-limit.ts';

describe('RateLimiter', () => {
	it('lets a burst of `capacity` through, then refuses', () => {
		const limiter = new RateLimiter(3, 60_000);
		expect([1, 2, 3, 4].map(() => limiter.take('a', 0))).toEqual([true, true, true, false]);
	});

	it('keeps each key to its own bucket', () => {
		const limiter = new RateLimiter(1, 60_000);
		expect(limiter.take('a', 0)).toBe(true);
		expect(limiter.take('a', 0)).toBe(false);
		expect(limiter.take('b', 0)).toBe(true);
	});

	it('refills continuously, at capacity per period', () => {
		const limiter = new RateLimiter(2, 60_000);
		limiter.take('a', 0);
		limiter.take('a', 0);
		expect(limiter.take('a', 10_000)).toBe(false);
		// Half a period refills half the bucket: one token.
		expect(limiter.take('a', 30_000)).toBe(true);
		expect(limiter.take('a', 30_000)).toBe(false);
	});

	it('spends nothing on a refusal, so hammering does not dig the hole deeper', () => {
		const limiter = new RateLimiter(1, 60_000);
		limiter.take('a', 0);
		for (let i = 0; i < 100; i++) limiter.take('a', 1);
		expect(limiter.take('a', 60_001)).toBe(true);
	});

	it('forgets the least recently seen key past maxKeys, rather than growing', () => {
		const limiter = new RateLimiter(1, 60_000, 2);
		limiter.take('a', 0);
		limiter.take('b', 0);
		limiter.take('c', 0);
		// `a` was evicted, so it has a fresh bucket; `c` has not, so it is still empty.
		expect(limiter.take('a', 0)).toBe(true);
		expect(limiter.take('c', 0)).toBe(false);
	});
});

describe('networkOf', () => {
	it('keys IPv4 by the address itself, mapped or not', () => {
		expect(networkOf('203.0.113.9')).toBe('203.0.113.9');
		expect(networkOf('::ffff:203.0.113.9')).toBe('203.0.113.9');
	});

	it('keys IPv6 by its /64, so one connection cannot be endless visitors', () => {
		const a = networkOf('2001:db8:1:2:aaaa::1');
		const b = networkOf('2001:0db8:0001:0002:ffff:ffff:ffff:ffff');
		expect(a).toBe('2001:db8:1:2::/64');
		expect(b).toBe(a);
		expect(networkOf('2001:db8:1:3::1')).not.toBe(a);
	});

	it('expands a compressed prefix before cutting it', () => {
		expect(networkOf('2001:db8::1')).toBe('2001:db8:0:0::/64');
		expect(networkOf('::1')).toBe('0:0:0:0::/64');
	});
});
