import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the row-12 sales mutations, applied by
 * `withMutationGuards` before the command runs. Posting a run writes the sales
 * facts, the daily consumption writes the append-only ledger, and reversing a
 * line posts its reversal line and every reversal movement (`DEC-116`), so all
 * are bounded. Like every limiter in this app the window is per-process — a
 * shared store is the pre-multi-instance follow-up.
 */
export const salesLimiters = {
  postImportRun: createInMemoryRateLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES_MS }),
  consumption: createInMemoryRateLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES_MS }),
  reverseSalesLine: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
