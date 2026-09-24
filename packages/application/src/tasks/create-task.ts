import { DomainError } from "@aquarela/domain";

import { TASK_AUDIT_ACTIONS } from "./actions";
import type { TaskRecord, TaskStore } from "./types";

export interface CreateTaskInput {
  readonly organizationId: string;
  /** The acting actor; recorded as `created_by`. */
  readonly actorId: string;
  /** Free text; the spec defines no vocabulary for a task type (`DEC-101`). */
  readonly type: string;
  /** Free text; the spec defines no vocabulary for a task priority (`DEC-101`). */
  readonly priority: string;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly dueDate?: string | null;
  /** The assignee at creation, or null for an unassigned task. */
  readonly ownerId?: string | null;
  /** Polymorphic link pair; either both set or both null. */
  readonly linkedEntityType?: string | null;
  readonly linkedEntityId?: string | null;
}

/**
 * Creates one task (`DEC-122`). The status is always the machine's only entry
 * state, `open` — creation is not a transition, so it is not routed through the
 * guard. The `type` and `priority` are free text (`DEC-101`) and only checked
 * non-blank here; the linked-entity pair is checked all-or-nothing so the
 * database `task_linked_entity_check` is never the first to notice a half link.
 *
 * The row and its `workflow.task.created` audit fact commit or roll back
 * together.
 */
export async function createTask(store: TaskStore, input: CreateTaskInput): Promise<TaskRecord> {
  const type = input.type.trim();
  if (type.length === 0) {
    throw new DomainError("type is required");
  }
  const priority = input.priority.trim();
  if (priority.length === 0) {
    throw new DomainError("priority is required");
  }

  const linkedEntityType = input.linkedEntityType ?? null;
  const linkedEntityId = input.linkedEntityId ?? null;
  if ((linkedEntityType === null) !== (linkedEntityId === null)) {
    throw new DomainError("linkedEntityType and linkedEntityId must be set together");
  }

  return store.withTransaction(async (tx) => {
    const created = await tx.createTask({
      organizationId: input.organizationId,
      type,
      priority,
      dueDate: input.dueDate ?? null,
      ownerId: input.ownerId ?? null,
      linkedEntityType,
      linkedEntityId,
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: TASK_AUDIT_ACTIONS.taskCreated,
      entityType: "task",
      entityId: created.id,
      after: {
        type: created.type,
        priority: created.priority,
        status: created.status,
        owner_id: created.ownerId,
        due_date: created.dueDate,
      },
    });

    return created;
  });
}
