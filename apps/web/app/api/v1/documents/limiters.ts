import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the staff document library mutations, applied by
 * `withMutationGuards` before the command runs. Creating a document or a version
 * is the rarer create (60); amending a document, publishing a version and
 * acknowledging one are the amendment writes (120) — the same values as the
 * workforce slice. The counter is the shared `DEC-135` store, so every instance
 * enforces one window; a store outage fails open.
 */
export const documentLimiters = createSharedLimiters("documents", {
  createDocument: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  updateDocument: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  createVersion: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  uploadVersionFile: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  publishVersion: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  acknowledge: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
});
