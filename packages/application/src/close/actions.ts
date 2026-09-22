/**
 * Audit action vocabulary for the close/lock slice (`REC-003`, `REC-006`,
 * `DEC-027`, row 13a). Values are the `audit_event.action` strings; keeping them
 * here stops a handler from drifting into near-duplicate names.
 *
 * A close is mutated, not append-only, so each lifecycle transition
 * (`started`, `locked`, `reopened`) records its own action rather than
 * overloading `updated`. An idempotent re-lock, or a `begin` while already
 * `closing`, writes **no** fact (the payroll `generated` no-op precedent).
 */
export const CLOSE_AUDIT_ACTIONS = {
  periodCloseStarted: "close.period_close.started",
  periodCloseLocked: "close.period_close.locked",
  periodCloseReopened: "close.period_close.reopened",
} as const;
