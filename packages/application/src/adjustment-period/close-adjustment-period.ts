import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { ADJUSTMENT_PERIOD_AUDIT_ACTIONS } from "./actions";
import type { AdjustmentPeriodRecord, AdjustmentPeriodStore } from "./types";

export interface CloseAdjustmentPeriodInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly adjustmentPeriodId: string;
}

/**
 * Closes one adjustment period (`REC-006`, `DEC-027`), ending the correction
 * window. The row is loaded organization-scoped **under its write lock**
 * (`lockAdjustmentPeriodById`, `SELECT … FOR UPDATE`), so two concurrent closes
 * serialise and only the first writes an audit fact; a missing or
 * cross-organization id is a typed `NotFoundError`. An already-`closed` row is
 * returned unchanged with **no** audit fact (idempotent re-close); any status
 * other than `open` (or `closed`) is a `DomainError`. The `closed` status and the
 * audit fact commit or roll back together.
 */
export async function closeAdjustmentPeriod(
  store: AdjustmentPeriodStore,
  input: CloseAdjustmentPeriodInput,
): Promise<AdjustmentPeriodRecord> {
  if (isBlank(input.adjustmentPeriodId)) {
    throw new DomainError("adjustmentPeriodId is required");
  }

  return store.withTransaction(async (tx) => {
    const existing = await tx.lockAdjustmentPeriodById({
      organizationId: input.organizationId,
      id: input.adjustmentPeriodId.trim(),
    });
    if (existing === undefined) {
      throw new NotFoundError("adjustment period not found in organization");
    }
    if (existing.status === "closed") {
      // Idempotent: already closed, so nothing changes and no audit fact is written.
      return existing;
    }
    if (existing.status !== "open") {
      throw new DomainError(`adjustment period in status ${existing.status} cannot be closed`);
    }

    const updated = await tx.updateAdjustmentPeriod({
      organizationId: input.organizationId,
      adjustmentPeriodId: existing.id,
      status: "closed",
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("adjustment period not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: ADJUSTMENT_PERIOD_AUDIT_ACTIONS.adjustmentPeriodClosed,
      entityType: "adjustment_period",
      entityId: updated.id,
      before: { status: existing.status },
      after: { status: updated.status },
    });

    return updated;
  });
}
