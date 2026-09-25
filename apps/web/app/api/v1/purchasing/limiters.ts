import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the purchasing master-data mutations, applied by
 * `withMutationGuards` before the command runs. The counter is the shared
 * `DEC-135` store, so every instance enforces one window; a store outage fails
 * open.
 */
export const purchasingLimiters = createSharedLimiters("purchasing", {
  registerSupplier: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
});
