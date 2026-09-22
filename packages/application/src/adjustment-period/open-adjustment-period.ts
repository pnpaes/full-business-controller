import { DomainError } from "@aquarela/domain";

import { ADJUSTMENT_PERIOD_AUDIT_ACTIONS } from "./actions";
import type { AdjustmentPeriodRecord, AdjustmentPeriodStore } from "./types";

export interface OpenAdjustmentPeriodInput {
  readonly organizationId: string;
  readonly actorId: string;
  /** `date`, `YYYY-MM-DD`; the window opens here. */
  readonly openedFrom: string;
  /** `date`, `YYYY-MM-DD`; `>= openedFrom`. */
  readonly openedTo: string;
  /** Required, non-empty justification for the correction window. */
  readonly reason: string;
}

/** A `date` column's wire form: `YYYY-MM-DD` with no time part. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `date` columns are carried as `YYYY-MM-DD`. The regex alone accepts an
 * impossible day such as `2026-02-31`, which would reach Postgres as a driver
 * error rather than a `DomainError`, so the day is round-tripped through `Date`
 * too (the domain `resolveClosePeriod` precedent — the domain helper is not
 * exported, so the check is local here).
 */
function assertCalendarDate(value: string, field: string): void {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !ISO_DATE.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new DomainError(`${field} must be a date (YYYY-MM-DD)`);
  }
}

/**
 * Opens one adjustment period (`REC-006`, `DEC-027`): a management-declared
 * correction window `[openedFrom, openedTo]` with a required `reason`. The dates
 * are validated (`openedTo >= openedFrom`) and the reason must be non-empty
 * before the store is touched.
 *
 * Inside one transaction the organization's open period is read first; if one
 * already exists the call is refused with a `DomainError` — at most one open
 * adjustment period per organization at a time. Approval is **single-stage**: the
 * acting actor is recorded as `approvedBy` with `approvedAt = now`, and the row is
 * created `open`. A create that collides with the partial unique
 * `adjustment_period_open_key` is a race with a concurrent open: the winner is
 * re-read and returned (the `beginPeriodClose` create-race precedent) instead of
 * surfacing a driver error. The row and its `close.adjustment_period.opened` fact
 * commit or roll back together.
 *
 * The create-race recovery runs on a **fresh** transaction: on Postgres the
 * unique violation has already aborted the failed transaction, so an
 * in-transaction re-read would throw `25P02` ("current transaction is aborted")
 * and replace the original error. The re-read therefore happens outside the
 * failed `withTransaction`, and only once the failed path actually dispatched the
 * INSERT. (This flaw was copied from the committed `close` slice, fixed there in
 * the sibling slice.)
 */
export async function openAdjustmentPeriod(
  store: AdjustmentPeriodStore,
  input: OpenAdjustmentPeriodInput,
): Promise<AdjustmentPeriodRecord> {
  assertCalendarDate(input.openedFrom, "openedFrom");
  assertCalendarDate(input.openedTo, "openedTo");
  if (input.openedTo < input.openedFrom) {
    throw new DomainError("openedTo must be on or after openedFrom");
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length === 0) {
    throw new DomainError("reason is required");
  }

  // Set only once the INSERT is dispatched, so the recovery below never mistakes
  // an unrelated transaction failure (e.g. the pre-check's refusal) for a race.
  let createAttempted = false;

  try {
    return await store.withTransaction(async (tx) => {
      const existing = await tx.findOpenAdjustmentPeriod({
        organizationId: input.organizationId,
      });
      if (existing !== undefined) {
        throw new DomainError("an open adjustment period already exists for the organization");
      }

      const approvedAt = new Date().toISOString();
      createAttempted = true;
      const created = await tx.createAdjustmentPeriod({
        organizationId: input.organizationId,
        openedFrom: input.openedFrom,
        openedTo: input.openedTo,
        reason,
        status: "open",
        approvedBy: input.actorId,
        approvedAt,
        createdBy: input.actorId,
      });

      await tx.writeAudit({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: ADJUSTMENT_PERIOD_AUDIT_ACTIONS.adjustmentPeriodOpened,
        entityType: "adjustment_period",
        entityId: created.id,
        after: {
          status: created.status,
          opened_from: created.openedFrom,
          opened_to: created.openedTo,
          approved_by: created.approvedBy,
          approved_at: created.approvedAt,
        },
      });

      return created;
    });
  } catch (error) {
    // Two concurrent opens both miss the existence read (there is no row to
    // see), so one INSERT wins and the other hits the partial unique (23505).
    // That aborts the failed transaction, so the winner can only be observed
    // from a fresh transaction: re-read outside the failed `withTransaction` and,
    // if the winner's open row is present, return it (no second fact).
    if (!createAttempted) {
      throw error;
    }
    const raced = await store.findOpenAdjustmentPeriod({
      organizationId: input.organizationId,
    });
    if (raced === undefined) {
      throw error;
    }
    return raced;
  }
}
