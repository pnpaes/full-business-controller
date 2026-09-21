import { DomainError, NotFoundError } from "@aquarela/domain";
import { CORRECTIVE_ACTION_STATUS } from "@aquarela/persistence";

import { isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import { assertOptionalCalendarDate } from "./register-incident";
import type { HmsStore, CorrectiveActionRecord } from "./types";

/** The `status` vocabulary (`CORRECTIVE_ACTION_STATUS`). */
export const CORRECTIVE_ACTION_STATUSES: readonly string[] = CORRECTIVE_ACTION_STATUS;

export interface UpdateCorrectiveActionInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly correctiveActionId: string;
  /** One of `CORRECTIVE_ACTION_STATUS`. */
  readonly status?: string;
  /** `null` clears the optional owner. */
  readonly ownerId?: string | null;
  /** `date`, `YYYY-MM-DD`, or null to clear it. */
  readonly dueDate?: string | null;
  /** Non-empty; trimmed. Omitted leaves the description unchanged. */
  readonly description?: string;
}

/** Patch field → audit payload key, so `before`/`after` share one shape. */
const AUDIT_FIELDS = {
  status: "status",
  ownerId: "owner_id",
  dueDate: "due_date",
  description: "description",
} as const;

/**
 * Amends or advances one corrective action (`HMS-004`, `DEC-090`). The action is
 * loaded organization-scoped first (`DEC-061`; a missing or cross-organization id
 * is a typed `NotFoundError`), then the patch is validated: `status` is checked
 * against `CORRECTIVE_ACTION_STATUS` and `description` must stay non-empty.
 *
 * Two derived invariants are kept coherent with `status`:
 * - `completed_at` is non-null iff the status is `done` or `verified` (set when
 *   entering that set, cleared when leaving it);
 * - `verified_by`/`verified_at` are non-null iff the status is `verified`; on the
 *   transition into `verified` the verifier is the acting `actorId`, and once set
 *   they are preserved, so re-verifying an already-verified action is idempotent
 *   and does not overwrite the original verifier.
 * The update and its audit fact — `hms.corrective_action.verified` on the
 * verification transition, `hms.corrective_action.completed` on entering
 * `done`/`verified` from outside, `hms.corrective_action.updated` otherwise —
 * commit or roll back together.
 */
export async function updateCorrectiveAction(
  store: HmsStore,
  input: UpdateCorrectiveActionInput,
): Promise<CorrectiveActionRecord> {
  if (isBlank(input.correctiveActionId)) {
    throw new DomainError("correctiveActionId is required");
  }

  return store.withTransaction(async (tx) => {
    const action = await tx.findCorrectiveAction({
      organizationId: input.organizationId,
      correctiveActionId: input.correctiveActionId.trim(),
    });
    if (action === undefined) {
      throw new NotFoundError("corrective action not found in organization");
    }

    const mutable: {
      status?: string;
      ownerId?: string | null;
      dueDate?: string | null;
      description?: string;
      completedAt?: string | null;
      verifiedBy?: string | null;
      verifiedAt?: string | null;
    } = {};

    let verifiedTransition = false;
    let completedTransition = false;
    if (input.status !== undefined) {
      if (!CORRECTIVE_ACTION_STATUSES.includes(input.status)) {
        throw new DomainError(`status must be one of ${CORRECTIVE_ACTION_STATUSES.join(", ")}`);
      }
      mutable.status = input.status;
      const now = new Date().toISOString();
      const wasCompleted = action.status === "done" || action.status === "verified";
      const isCompleted = input.status === "done" || input.status === "verified";
      // `completed_at` is non-null iff the status is `done`/`verified`.
      mutable.completedAt = isCompleted ? (wasCompleted ? action.completedAt : now) : null;
      // `verified_by`/`verified_at` are non-null iff the status is `verified`.
      // Verifying an already-verified action preserves the original verifier —
      // the verification is idempotent, so a second verify must not move it.
      if (input.status === "verified") {
        mutable.verifiedBy = action.status === "verified" ? action.verifiedBy : input.actorId;
        mutable.verifiedAt = action.status === "verified" ? action.verifiedAt : now;
      } else {
        mutable.verifiedBy = null;
        mutable.verifiedAt = null;
      }
      verifiedTransition = input.status === "verified" && action.status !== "verified";
      completedTransition = isCompleted && !wasCompleted;
    }
    if (input.description !== undefined) {
      if (isBlank(input.description)) {
        throw new DomainError("description is required");
      }
      mutable.description = input.description.trim();
    }
    if (input.ownerId !== undefined) {
      mutable.ownerId = input.ownerId;
    }
    if (input.dueDate !== undefined) {
      assertOptionalCalendarDate(input.dueDate, "dueDate");
      mutable.dueDate = input.dueDate;
    }

    if (Object.keys(mutable).length === 0) {
      throw new DomainError("no updatable fields provided");
    }

    const updated = await tx.updateCorrectiveAction({
      organizationId: input.organizationId,
      correctiveActionId: action.id,
      ...mutable,
      updatedBy: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("corrective action not found in organization");
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of Object.keys(AUDIT_FIELDS) as (keyof typeof AUDIT_FIELDS)[]) {
      if (mutable[field] === undefined) continue;
      before[AUDIT_FIELDS[field]] = action[field];
      after[AUDIT_FIELDS[field]] = updated[field];
    }

    const auditAction = verifiedTransition
      ? HMS_AUDIT_ACTIONS.correctiveActionVerified
      : completedTransition
        ? HMS_AUDIT_ACTIONS.correctiveActionCompleted
        : HMS_AUDIT_ACTIONS.correctiveActionUpdated;
    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: auditAction,
      entityType: "corrective_action",
      entityId: updated.id,
      before,
      after,
    });

    return updated;
  });
}
