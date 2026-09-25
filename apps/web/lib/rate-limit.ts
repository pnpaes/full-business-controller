import { consumeRateLimit } from "@aquarela/persistence";

import { getDb } from "./db";

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Seconds until the next slot frees; `0` when allowed. */
  readonly retryAfterSeconds: number;
}

/**
 * Narrow port so a shared (DB/Redis) limiter can replace the in-memory one.
 * `check` is allowed to be async because the shared store is a database round
 * trip; `await` on the in-memory decision is a no-op.
 */
export interface RateLimiter {
  check(key: string, now?: Date): RateLimitDecision | Promise<RateLimitDecision>;
}

/** A limiter whose `check` is synchronous — assignable to `RateLimiter`. */
export interface SyncRateLimiter {
  check(key: string, now?: Date): RateLimitDecision;
}

export interface InMemoryRateLimiterOptions {
  readonly limit: number;
  readonly windowMs: number;
}

/** What a limiter does when the shared store cannot be reached. */
export type StoreFailureMode = "open" | "closed";

export interface SharedRateLimiterOptions {
  /**
   * Stable limiter name, e.g. `documents.createDocument`. It keys the shared
   * counter so one policy never shares its window with another (the in-memory
   * limiter got that isolation from one map per instance).
   */
  readonly namespace: string;
  readonly limit: number;
  readonly windowMs: number;
  /**
   * Store-unavailable policy. `open` allows the request (availability); the
   * request then gets the pre-change per-process behaviour only. `closed`
   * denies it (auth-adjacent gates, where the throttle is the control).
   */
  readonly failMode: StoreFailureMode;
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
 * Per-process sliding-window rate limiter. Kept because the unit tests drive it
 * directly and because `DEC-135` treats it as the documented fallback posture:
 * when the shared store is unreachable a limiter degrades to this behaviour.
 * Callers pass `now` in tests to drive window expiry deterministically.
 */
export function createInMemoryRateLimiter(options: InMemoryRateLimiterOptions): SyncRateLimiter {
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

/**
 * `DEC-135`: the shared limiter. Same interface and the same sliding window as
 * `createInMemoryRateLimiter`, but the counter lives in `rate_limit_counter`
 * (`consumeRateLimit`), so every instance enforces one window instead of one
 * per worker. `maxKeys`/`prune` are deliberately absent: the store holds one
 * bounded hit array per `(namespace, key)` and Postgres, not a process map,
 * owns isolation.
 *
 * The store call is the only difference; the store's own atomic upsert decides
 * admission, and the per-call-site `failMode` decides what happens when the
 * store cannot be reached.
 */
export function createSharedRateLimiter(options: SharedRateLimiterOptions): RateLimiter {
  const { namespace, limit, windowMs, failMode } = options;

  return {
    async check(key: string, now: Date = new Date()): Promise<RateLimitDecision> {
      try {
        return await consumeRateLimit(getDb().db, { namespace, key, limit, windowMs, now });
      } catch {
        // Never log here: a driver error can carry the connection string. The
        // store is unavailable, so apply the call site's documented posture.
        return failMode === "closed"
          ? { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)) }
          : { allowed: true, retryAfterSeconds: 0 };
      }
    },
  };
}

type LimiterConfig = { readonly limit: number; readonly windowMs: number };

/**
 * Builds a module's named limiter set from one namespace, deriving each
 * counter's name from its key (`"<namespace>.<key>"`). The derivation is the
 * point: a shared-store counter is global, so a copy-pasted literal name would
 * silently merge two policies' windows; an object key cannot collide with
 * itself.
 */
export function createSharedLimiters<T extends Record<string, LimiterConfig>>(
  namespace: string,
  configs: T,
  failMode: StoreFailureMode = "open",
): { readonly [K in keyof T]: RateLimiter } {
  const entries = Object.entries(configs).map(
    ([name, config]) =>
      [
        name,
        createSharedRateLimiter({ namespace: `${namespace}.${name}`, failMode, ...config }),
      ] as const,
  );
  return Object.fromEntries(entries) as { readonly [K in keyof T]: RateLimiter };
}
