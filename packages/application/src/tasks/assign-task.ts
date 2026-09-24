import { DomainError, NotFoundError } from "@aquarela/domain";

import { TASK_AUDIT_ACTIONS } from "./actions";
import { isTerminalTaskStatus } from "./status-machine";
import type { TaskRecord, TaskStore } from "./types";

export interface AssignTaskInput {
  readonly organizationId: string;
  /** The acting actor; recorded as `updated_by`. */
  readonly actorId: string;
  readonly taskId: string;
  /** The new assignee, or null to unassign. */
  readonly ownerId: string | null;
}

/**
 * Sets or clears one task's assignee (`DEC-122`). A task is read
 * organization-scoped (`DEC-061`) first; a terminal task (`resolved`/`dismissed`)
 * may not be reassigned — a defensive guard beyond the recorded status machine,
 * so a completed task is not silently reopened for work by an assignment. A
 * missing or cross-organization id is a typed `NotFoundError` (HTTP 404).
 *
 * The row and its `workflow.task.assigned` audit fact commit or roll back
 * together.
 */
export async function assignTask(store: TaskStore, input: AssignTaskInput): Promise<TaskRecord> {
  return store.withTransaction(async (tx) => {
    const existing = await tx.findTask({
      organizationId: input.organizationId,
      taskId: input.taskId,
    });
    if (existing === undefined) {
      throw new NotFoundError("task not found in organization");
    }
    if (isTerminalTaskStatus(existing.status)) {
      throw new DomainError("cannot assign a task that is resolved or dismissed");
    }

    const updated = await tx.updateTask({
      organizationId: input.organizationId,
      taskId: input.taskId,
      ownerId: input.ownerId,
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("task not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: TASK_AUDIT_ACTIONS.taskAssigned,
      entityType: "task",
      entityId: updated.id,
      before: { owner_id: existing.ownerId },
      after: { owner_id: updated.ownerId },
    });

    return updated;
  });
}
