import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { CLOSE_AUDIT_ACTIONS } from "./actions";
import type { PeriodCloseRecord, PeriodCloseStore } from "./types";

export interface ReopenPeriodCloseInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly periodCloseId: string;
  /** Required, non-empty justification; stored as `reopen_reason`. */
  readonly reason: string;
}

/**
 * Reopens one locked close (`REC-006`, `DEC-027`): the audited, elevated-permission
 * path back to an editable state. `reason` is required and non-empty (a
 * `DomainError` otherwise). The row is loaded organization-scoped **under its
 * write lock** (`lockPeriodCloseById`, `SELECT … FOR UPDATE`), so two concurrent
 * reopens serialise and only the first writes an audit fact; a missing or
 * cross-organization id is a typed `NotFoundError` and only a `locked` row may be
 * reopened — any other status is a `DomainError`. The `reopened` status, the
 * `reopened_by`/`reopened_at`/`reopen_reason` triple and the audit fact commit or
 * roll back together; the `0058` trigger permits the `locked → reopened`
 * transition.
 */
export async function reopenPeriodClose(
  store: PeriodCloseStore,
  input: ReopenPeriodCloseInput,
): Promise<PeriodCloseRecord> {
  if (isBlank(input.periodCloseId)) {
    throw new DomainError("periodCloseId is required");
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length === 0) {
    throw new DomainError("reopen reason is required");
  }

  return store.withTransaction(async (tx) => {
    const existing = await tx.lockPeriodCloseById({
      organizationId: input.organizationId,
      id: input.periodCloseId.trim(),
    });
    if (existing === undefined) {
      throw new NotFoundError("period close not found in organization");
    }
    if (existing.status !== "locked") {
      throw new DomainError(`period close in status ${existing.status} cannot be reopened`);
    }

    const updated = await tx.updatePeriodClose({
      organizationId: input.organizationId,
      periodCloseId: existing.id,
      status: "reopened",
      reopenedBy: input.actorId,
      reopenedAt: new Date().toISOString(),
      reopenReason: reason,
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("period close not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: CLOSE_AUDIT_ACTIONS.periodCloseReopened,
      entityType: "period_close",
      entityId: updated.id,
      before: { status: existing.status },
      after: {
        status: updated.status,
        reopened_by: updated.reopenedBy,
        reopened_at: updated.reopenedAt,
      },
      reason,
    });

    return updated;
  });
}
