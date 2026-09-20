import { DomainError } from "@aquarela/domain";
import { RECONCILIATION_STATUS } from "@aquarela/persistence";

import { isBlank } from "../imports/validation";

import { RECONCILIATION_AUDIT_ACTIONS } from "./actions";
import type { ReconciliationRecord, ReconciliationStore } from "./types";

const STATUSES: readonly string[] = RECONCILIATION_STATUS;

/** Statuses that close a reconciliation out and therefore require a note. */
const RESOLVING_STATUSES: readonly string[] = ["resolved", "approved"];

export interface ResolveReconciliationInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly reconciliationId: string;
  /** One of `RECONCILIATION_STATUS` (`pending` → `approved`, `REC-001`/`005`). */
  readonly status: string;
  /** Required when moving to `resolved`/`approved`; optional otherwise. */
  readonly resolutionNote?: string | null;
  readonly ownerId?: string | null;
  /** `yyyy-mm-dd`. */
  readonly dueDate?: string | null;
}

/**
 * Moves a reconciliation through its lifecycle and records the resolution trail
 * (`REC-001`/`005`). The status must be in the vocabulary; `resolved`/`approved`
 * require a resolution note so an exception is never closed without a reason.
 * The organization is part of the update's WHERE clause, so another tenant's
 * row can never be patched.
 */
export async function resolveReconciliation(
  store: ReconciliationStore,
  input: ResolveReconciliationInput,
): Promise<ReconciliationRecord> {
  if (!STATUSES.includes(input.status)) {
    throw new DomainError(`unknown reconciliation status: ${input.status}`);
  }
  if (RESOLVING_STATUSES.includes(input.status) && isBlank(input.resolutionNote)) {
    throw new DomainError(`a resolution note is required to mark a reconciliation ${input.status}`);
  }

  return store.withTransaction(async (tx) => {
    const existing = await tx.findReconciliation({
      organizationId: input.organizationId,
      reconciliationId: input.reconciliationId,
    });
    if (existing === undefined) {
      throw new DomainError("reconciliation not found in organization");
    }

    const updated = await tx.updateReconciliation(
      { organizationId: input.organizationId, reconciliationId: existing.id },
      {
        status: input.status,
        updatedBy: input.actorId,
        ...(input.resolutionNote === undefined ? {} : { resolutionNote: input.resolutionNote }),
        ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
        ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
      },
    );
    if (updated === undefined) {
      throw new DomainError("reconciliation not found for update");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: RECONCILIATION_AUDIT_ACTIONS.reconciliationResolved,
      entityType: "reconciliation",
      entityId: updated.id,
      before: { status: existing.status },
      after: { status: updated.status, resolution_note: updated.resolutionNote },
    });

    return updated;
  });
}
