import {
  DomainError,
  NotFoundError,
  assertCloseChecklist,
  buildCloseSnapshot,
  resolveClosePeriod,
} from "@aquarela/domain";

import { CLOSE_AUDIT_ACTIONS } from "./actions";
import type { PeriodCloseRecord, PeriodCloseScopeType, PeriodCloseStore } from "./types";

export interface BeginPeriodCloseInput {
  readonly organizationId: string;
  readonly actorId: string;
  /** One of `PERIOD_CLOSE_SCOPE_TYPES`. */
  readonly scopeType: string;
  /** The `location.id` (location scope) or `organization.id` (company scope). */
  readonly scopeId: string;
  /** `date`, `YYYY-MM-DD`; the scope's period is derived from it. */
  readonly periodStart: string;
  /** The close-task list; validated by `assertCloseChecklist`. */
  readonly checklist: unknown;
}

/**
 * Begins (or re-begins) the close of one scope and period (`REC-003`, `DEC-027`).
 * The period is derived from `scopeType`/`periodStart` via `resolveClosePeriod`
 * (location ⇒ a single day; company ⇒ the UTC calendar month) and the checklist
 * is validated; the frozen snapshot is built with `capturedAt = now`.
 *
 * Inside one transaction the scope row is locked (`lockPeriodCloseForScope`,
 * `SELECT … FOR UPDATE`), so concurrent begins for one scope serialise. An
 * existing row is handled by its status:
 * - `locked` → a `DomainError` ("period is locked; reopen it first");
 * - `closing` → an **idempotent no-op** returning the existing row, with **no**
 *   audit fact;
 * - `open`/`reopened` → updated to `closing` with the new checklist/snapshot;
 * - no row → created as `closing`.
 *
 * A create or the reopen→closing update writes one
 * `close.period_close.started` fact; the row and its fact commit or roll back
 * together.
 */
export async function beginPeriodClose(
  store: PeriodCloseStore,
  input: BeginPeriodCloseInput,
): Promise<PeriodCloseRecord> {
  // `resolveClosePeriod` validates the scope and the day, so the cast below is safe.
  const period = resolveClosePeriod(input.scopeType, input.periodStart);
  const scopeType = input.scopeType as PeriodCloseScopeType;
  if (scopeType === "company" && input.scopeId !== input.organizationId) {
    throw new DomainError("company scope scopeId must be the organization id");
  }
  const checklist = assertCloseChecklist(input.checklist);
  const snapshot = buildCloseSnapshot({
    scopeType,
    scopeId: input.scopeId,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    capturedAt: new Date().toISOString(),
    checklist,
  });

  return store.withTransaction(async (tx) => {
    const existing = await tx.lockPeriodCloseForScope({
      organizationId: input.organizationId,
      scopeType,
      scopeId: input.scopeId,
      periodStart: period.periodStart,
    });

    if (existing !== undefined) {
      if (existing.status === "locked") {
        throw new DomainError("period is locked; reopen it first");
      }
      if (existing.status === "closing") {
        // Idempotent: the close is already under way, so nothing changes and no
        // audit fact is written (the payroll `generated` no-op precedent).
        return existing;
      }
      const updated = await tx.updatePeriodClose({
        organizationId: input.organizationId,
        periodCloseId: existing.id,
        status: "closing",
        checklist,
        snapshot,
        actorId: input.actorId,
      });
      if (updated === undefined) {
        throw new NotFoundError("period close not found in organization");
      }
      await tx.writeAudit({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: CLOSE_AUDIT_ACTIONS.periodCloseStarted,
        entityType: "period_close",
        entityId: updated.id,
        before: { status: existing.status },
        after: {
          status: updated.status,
          scope_type: updated.scopeType,
          scope_id: updated.scopeId,
          period_start: updated.periodStart,
          period_end: updated.periodEnd,
        },
      });
      return updated;
    }

    let created: PeriodCloseRecord;
    try {
      created = await tx.createPeriodClose({
        organizationId: input.organizationId,
        scopeType,
        scopeId: input.scopeId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        status: "closing",
        checklist,
        snapshot,
        createdBy: input.actorId,
      });
    } catch (error) {
      // Two concurrent begins for a brand-new scope both miss the lock read
      // (there is no row to lock), so one INSERT wins and the other hits the
      // unique (23505). Re-read; if the winner's row is present, treat this
      // begin as the idempotent no-op (no audit fact) and return it.
      const raced = await tx.findPeriodCloseForScope({
        organizationId: input.organizationId,
        scopeType,
        scopeId: input.scopeId,
        periodStart: period.periodStart,
      });
      if (raced !== undefined) {
        return raced;
      }
      throw error;
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: CLOSE_AUDIT_ACTIONS.periodCloseStarted,
      entityType: "period_close",
      entityId: created.id,
      after: {
        status: created.status,
        scope_type: created.scopeType,
        scope_id: created.scopeId,
        period_start: created.periodStart,
        period_end: created.periodEnd,
      },
    });

    return created;
  });
}
