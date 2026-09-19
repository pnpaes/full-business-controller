import { createDb } from "@aquarela/persistence";
import type { DbClient } from "@aquarela/persistence";

import { getConfig } from "./config";

/**
 * Module-scoped pooled client, created once per process on first use. In
 * development the handle is parked on `globalThis` so Next's hot reload reuses
 * one pool instead of leaking a pool per recompile. The pool is never closed
 * here: the process (or container) teardown is the lifetime boundary, so
 * `close()` is deliberately not wired to any hook.
 */
const globalForDb = globalThis as typeof globalThis & { __aquarelaWebDb?: DbClient };

export function getDb(): DbClient {
  globalForDb.__aquarelaWebDb ??= createDb(getConfig().DATABASE_URL);
  return globalForDb.__aquarelaWebDb;
}
