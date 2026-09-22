import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { CLOSE_AUDIT_ACTIONS } from "./actions";
import type { PeriodCloseRecord, PeriodCloseStore } from "./types";

export interface LockPeriodCloseInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly periodCloseId: string;
}

/**
 * Locks one close (`REC-003`/`REC-006`, `DEC-027`), freezing its snapshot. The
 * row is loaded organization-scoped **under its write lock**
 * (`lockPeriodCloseById`, `SELECT … FOR UPDATE`), so two concurrent locks
 * serialise and only the first writes an audit fact; a missing or
 * cross-organization id is a typed `NotFoundError`. An already-`locked` row is
 * returned unchanged with **no** audit fact (idempotent re-lock); any status
 * other than `closing` (or `locked`) is a `DomainError`. The `locked` status, the
 * `locked_by`/`locked_at` pair and the audit fact commit or roll back together;
 * the `0058` database trigger then keeps the snapshot, period, scope and lock
 * actor immutable.
 */
export async function lockPeriodClose(
  store: PeriodCloseStore,
  input: LockPeriodCloseInput,
): Promise<PeriodCloseRecord> {
  if (isBlank(input.periodCloseId)) {
    throw new DomainError("periodCloseId is required");
  }

  return store.withTransaction(async (tx) => {
    const existing = await tx.lockPeriodCloseById({
      organizationId: input.organizationId,
      id: input.periodCloseId.trim(),
    });
    if (existing === undefined) {
      throw new NotFoundError("period close not found in organization");
    }
    if (existing.status === "locked") {
      // Idempotent: already locked, so nothing changes and no audit fact is written.
      return existing;
    }
    if (existing.status !== "closing") {
      throw new DomainError(`period close in status ${existing.status} cannot be locked`);
    }

    const updated = await tx.updatePeriodClose({
      organizationId: input.organizationId,
      periodCloseId: existing.id,
      status: "locked",
      lockedBy: input.actorId,
      lockedAt: new Date().toISOString(),
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("period close not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: CLOSE_AUDIT_ACTIONS.periodCloseLocked,
      entityType: "period_close",
      entityId: updated.id,
      before: { status: existing.status },
      after: {
        status: updated.status,
        locked_by: updated.lockedBy,
        locked_at: updated.lockedAt,
      },
    });

    return updated;
  });
}
