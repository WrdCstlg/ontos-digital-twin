/**
 * In-memory sliding window rate limiter for Ontos platform.
 * Provides DoS and brute-force mitigation without external dependencies.
 * Features automated periodic garbage collection to prevent memory retention leaks.
 */

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();
  private lastCleanup = Date.now();
  private options: RateLimitOptions;

  constructor(options: RateLimitOptions) {
    this.options = options;
  }

  check(key: string): RateLimitStatus {
    const now = Date.now();
    const windowStart = now - this.options.windowMs;

    // Periodic cleanup of stale entries every 5 minutes
    if (now - this.lastCleanup > 300_000) {
      this.cleanup(now);
      this.lastCleanup = now;
    }

    const currentHits = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (currentHits.length >= this.options.max) {
      const oldest = currentHits[0];
      const resetMs = Math.max(0, oldest + this.options.windowMs - now);
      this.hits.set(key, currentHits);
      return { allowed: false, remaining: 0, resetMs };
    }

    currentHits.push(now);
    this.hits.set(key, currentHits);
    return {
      allowed: true,
      remaining: this.options.max - currentHits.length,
      resetMs: this.options.windowMs,
    };
  }

  private cleanup(now: number) {
    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter((t) => t > now - this.options.windowMs);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, valid);
      }
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

/** Authentication limiter: 10 attempts per 15 minutes per identifier */
export const authRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
});

/** Natural Language Query limiter: 30 queries per minute per user/client */
export const nlqRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
});

/** SPARQL endpoint limiter: 30 queries per minute per user */
export const sparqlRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
});

/** Heavy scan limiter (insights/reasoner): 10 runs per minute per user */
export const scanRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
});
