/**
 * Audit action vocabulary for the adjustment-period slice (`REC-006`,
 * `DEC-027`, row 13b). Values are the `audit_event.action` strings; keeping them
 * here stops a handler from drifting into near-duplicate names.
 *
 * An adjustment period is mutated, not append-only, so each lifecycle transition
 * (`opened`, `closed`) records its own action rather than overloading `updated`.
 * An idempotent re-close writes **no** fact (the payroll `generated` no-op
 * precedent).
 */
export const ADJUSTMENT_PERIOD_AUDIT_ACTIONS = {
  adjustmentPeriodOpened: "close.adjustment_period.opened",
  adjustmentPeriodClosed: "close.adjustment_period.closed",
} as const;
