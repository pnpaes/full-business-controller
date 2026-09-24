import { DomainError, NotFoundError } from "@aquarela/domain";

import { TASK_AUDIT_ACTIONS } from "./actions";
import { assertTaskStatusTransition } from "./status-machine";
import type { TaskRecord, TaskStore } from "./types";

export interface TransitionTaskInput {
  readonly organizationId: string;
  /** The acting actor; recorded as `updated_by`. */
  readonly actorId: string;
  readonly taskId: string;
  /** The target status; one of `TASK_STATUSES`. */
  readonly status: string;
}

/**
 * Transitions one task's status through the `DEC-122` machine. The current status
 * is read organization-scoped (`DEC-061`), the transition is checked by the pure
 * guard, and the write is a compare-and-set on the status just observed — so two
 * concurrent transitions cannot both pass the guard and both write; the loser
 * sees the row has moved and gets a `DomainError` (reload and retry) rather than
 * silently overwriting a transition it never validated.
 *
 * A missing or cross-organization id is a typed `NotFoundError` (HTTP 404); an
 * illegal or unknown transition is a message-only `DomainError` (HTTP 400). The
 * row and its `workflow.task.transitioned` audit fact commit or roll back
 * together.
 */
export async function transitionTask(
  store: TaskStore,
  input: TransitionTaskInput,
): Promise<TaskRecord> {
  return store.withTransaction(async (tx) => {
    const existing = await tx.findTask({
      organizationId: input.organizationId,
      taskId: input.taskId,
    });
    if (existing === undefined) {
      throw new NotFoundError("task not found in organization");
    }

    assertTaskStatusTransition(existing.status, input.status);

    const updated = await tx.transitionTaskStatus({
      organizationId: input.organizationId,
      taskId: input.taskId,
      fromStatus: existing.status,
      toStatus: input.status,
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new DomainError("task status changed concurrently; reload and retry");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: TASK_AUDIT_ACTIONS.taskTransitioned,
      entityType: "task",
      entityId: updated.id,
      before: { status: existing.status },
      after: { status: updated.status },
    });

    return updated;
  });
}
