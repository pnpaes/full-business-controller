export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Seconds until the next slot frees; `0` when allowed. */
  readonly retryAfterSeconds: number;
}

/** Narrow port so a shared (DB/Redis) limiter can replace the in-memory one. */
export interface RateLimiter {
  check(key: string, now?: Date): RateLimitDecision;
}

export interface InMemoryRateLimiterOptions {
  readonly limit: number;
  readonly windowMs: number;
}

/** Evicts fully-expired buckets and drops empty ones, bounding map growth. */
function prune(hits: Map<string, number[]>, cutoff: number): void {
  for (const [key, timestamps] of hits) {
    const kept = timestamps.filter((at) => at > cutoff);
    if (kept.length === 0) {
      hits.delete(key);
    } else {
      hits.set(key, kept);
    }
  }
}

/**
 * Per-process sliding-window rate limiter. Deliberately per-instance: it needs no
 * migration, but a multi-instance deployment gets one window per instance, so a
 * shared store is the follow-up (and requires its own migration). Callers pass
 * `now` in tests to drive window expiry deterministically.
 */
export function createInMemoryRateLimiter(options: InMemoryRateLimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  const hits = new Map<string, number[]>();
  const maxKeys = 10_000;

  return {
    check(key: string, now: Date = new Date()): RateLimitDecision {
      const at = now.getTime();
      const cutoff = at - windowMs;
      const recent = (hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

      if (recent.length >= limit) {
        const oldest = recent[0] ?? at;
        hits.set(key, recent);
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - at) / 1000)),
        };
      }

      recent.push(at);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        prune(hits, cutoff);
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
