import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the workforce mutations, applied by `withMutationGuards`
 * before the command runs. Registering an employee or a personnel document is
 * the rarer create (60); updating an employee, retiring one and replacing a
 * document are the amendment writes (120). The counter is the shared `DEC-135`
 * store, so every instance enforces one window; a store outage fails open.
 */
export const workforceLimiters = createSharedLimiters("workforce", {
  registerEmployee: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  updateEmployee: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  retireEmployee: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  createEmployeeDocument: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  updateEmployeeDocument: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  // `DEC-151` position catalogue: creating is the rarer write (60), amending or
  // deactivating is an amendment (120).
  registerPosition: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  updatePosition: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
});

/**
 * Per-IP throttles for the shift-scheduling mutations (`WF-002`/`WF-003`),
 * mirroring the personnel limits: planning a shift is the rarer create (60);
 * amending one, moving it through the lifecycle (publish/cancel/complete) and
 * assigning/withdrawing an assignment are the amendment writes (120). The
 * counter is the shared `DEC-135` store, so every instance enforces one window;
 * a store outage fails open.
 *
 * The payroll-input report mutations (`WF-005`, row 14b-2) sit here too rather
 * than in a fourth limiter object: generating a report is the rarer create (60)
 * and marking one exported is an amendment write (120).
 */
export const shiftLimiters = createSharedLimiters("shifts", {
  createShift: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  updateShift: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  publishShift: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  cancelShift: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  completeShift: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  assignShift: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  withdrawShiftAssignment: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  selfAssignShift: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  decideSelfAssignment: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  createShiftAdjustment: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
  generatePayrollReport: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  markPayrollReportExported: { limit: 120, windowMs: FIFTEEN_MINUTES_MS },
});
