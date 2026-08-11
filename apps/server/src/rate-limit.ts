// S3-6: tiny in-memory per-IP token-bucket rate limiter for HTTP routes. No external dep.
// Two buckets are exposed by default (auth + api) with different capacities/refills; the
// server picks the right one per route-prefix. Buckets are mutated lazily on consume().

interface Bucket {
  tokens: number;
  last: number;
}

export interface RateBucketConfig {
  capacity: number;
  // refill rate in tokens per millisecond (capacity / windowMs).
  refillPerMs: number;
}

export class TokenBucketRateLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly cfg: RateBucketConfig;
  // Sweeping the whole map on every consume is O(N); instead, opportunistic GC piggybacks on
  // each access: every `gcEvery` calls we drop entries that are fully refilled (cost == cap).
  private gcCounter = 0;
  private readonly gcEvery: number;

  constructor(cfg: RateBucketConfig, gcEvery = 256) {
    this.cfg = cfg;
    this.gcEvery = gcEvery;
  }

  // Returns true when the request is allowed (and consumes one token); false when over limit.
  consume(key: string, now: number = Date.now()): boolean {
    const cfg = this.cfg;
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: cfg.capacity, last: now };
      this.buckets.set(key, b);
    } else {
      const elapsed = Math.max(0, now - b.last);
      b.tokens = Math.min(cfg.capacity, b.tokens + elapsed * cfg.refillPerMs);
      b.last = now;
    }
    if ((this.gcCounter = (this.gcCounter + 1) % this.gcEvery) === 0) this.gc();
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    return false;
  }

  // Approximate seconds until the next token is available (for the Retry-After header).
  retryAfterSec(key: string, now: number = Date.now()): number {
    const b = this.buckets.get(key);
    if (!b) return 0;
    const elapsed = Math.max(0, now - b.last);
    const tokens = Math.min(this.cfg.capacity, b.tokens + elapsed * this.cfg.refillPerMs);
    if (tokens >= 1) return 0;
    const need = 1 - tokens;
    return Math.max(1, Math.ceil(need / this.cfg.refillPerMs / 1000));
  }

  private gc(): void {
    const cap = this.cfg.capacity;
    for (const [k, b] of this.buckets) {
      if (b.tokens >= cap) this.buckets.delete(k);
    }
  }
}

// Pre-bucketed limiter set used by the HTTP server: /auth/* is the tighter gate (10 req/min),
// /api/* is the looser gate (60 req/min). Skip /health and OPTIONS.
export interface HttpRateLimiters {
  auth: TokenBucketRateLimiter;
  api: TokenBucketRateLimiter;
}

export function createHttpRateLimiters(): HttpRateLimiters {
  return {
    auth: new TokenBucketRateLimiter({ capacity: 10, refillPerMs: 10 / 60_000 }),
    api: new TokenBucketRateLimiter({ capacity: 60, refillPerMs: 60 / 60_000 }),
  };
}

// Maps a request path/method to a (limiter, bucketName) pair, or null when the path is
// exempt from rate limiting (/health, OPTIONS preflight).
export function resolveRateBucket(
  method: string,
  path: string,
  limiters: HttpRateLimiters,
): { limiter: TokenBucketRateLimiter; name: "auth" | "api" } | null {
  if (method === "OPTIONS") return null;
  if (path === "/health" || path === "/") return null;
  if (path === "/auth/yandex/callback" || path === "/auth/me") {
    return { limiter: limiters.auth, name: "auth" };
  }
  if (path.startsWith("/api/")) {
    return { limiter: limiters.api, name: "api" };
  }
  return null;
}
