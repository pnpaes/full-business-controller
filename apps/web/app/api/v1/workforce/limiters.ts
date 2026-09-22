import { createInMemoryRateLimiter } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the workforce mutations, applied by `withMutationGuards`
 * before the command runs. Registering an employee or a personnel document is
 * the rarer create (60); updating an employee, retiring one and replacing a
 * document are the amendment writes (120). Like every limiter in this app the
 * window is per-process — a shared store is the pre-multi-instance follow-up.
 */
export const workforceLimiters = {
  registerEmployee: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  updateEmployee: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  retireEmployee: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  createEmployeeDocument: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  updateEmployeeDocument: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
} as const;

/**
 * Per-IP throttles for the shift-scheduling mutations (`WF-002`/`WF-003`),
 * mirroring the personnel limits: planning a shift is the rarer create (60);
 * amending one, moving it through the lifecycle (publish/cancel/complete) and
 * assigning/withdrawing an assignment are the amendment writes (120). Like every
 * limiter in this app the window is per-process — a shared store is the
 * pre-multi-instance follow-up.
 */
export const shiftLimiters = {
  createShift: createInMemoryRateLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES_MS }),
  updateShift: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  publishShift: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  cancelShift: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  completeShift: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  assignShift: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
  withdrawShiftAssignment: createInMemoryRateLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES_MS }),
} as const;
