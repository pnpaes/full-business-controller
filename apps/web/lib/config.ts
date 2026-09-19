import { loadConfig } from "@aquarela/config";
import type { AppConfig } from "@aquarela/config";

/**
 * Lazily loads and memoises the validated environment. Kept lazy so importing a
 * route module never reads `process.env` at build time (a missing `DATABASE_URL`
 * must fail the request, not the build).
 */
let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}
