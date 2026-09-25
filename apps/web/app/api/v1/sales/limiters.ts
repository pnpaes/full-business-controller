import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the row-12 sales mutations, applied by
 * `withMutationGuards` before the command runs. Posting a run writes the sales
 * facts, the daily consumption writes the append-only ledger, and reversing a
 * line posts its reversal line and every reversal movement (`DEC-116`), so all
 * are bounded. The counter is the shared `DEC-135` store, so every instance
 * enforces one window; a store outage fails open.
 */
export const salesLimiters = createSharedLimiters("sales", {
  postImportRun: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  consumption: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  reverseSalesLine: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
});
