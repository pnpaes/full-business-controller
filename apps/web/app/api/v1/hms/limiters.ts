import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the HMS mutations, applied by `withMutationGuards` before
 * the command runs. Registering a point, an incident or a checklist template is
 * the rare configuration write (60); recording a reading, a corrective action or
 * a checklist run, and the status-driven updates, are the frequent operational
 * ones (120). The counter is the shared `DEC-135` store, so every instance
 * enforces one window; a store outage fails open.
 */
export const hmsLimiters = createSharedLimiters("hms", {
  registerPoint: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  recordReading: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  registerIncident: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  updateIncident: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  recordCorrectiveAction: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  updateCorrectiveAction: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  registerChecklistTemplate: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  updateChecklistTemplate: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  recordChecklistRun: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  updateChecklistRun: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  registerEquipment: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  updateEquipment: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  recordMaintenanceLog: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
});
