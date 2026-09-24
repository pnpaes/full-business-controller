import { randomUUID } from "node:crypto";

import type { AuditInput } from "../auth";
import type {
  AssignableUser,
  NewTaskRecord,
  TaskListQuery,
  TaskRecord,
  TaskStore,
  TransitionTaskStatusRecord,
  UpdateTaskRecord,
} from "./types";

/**
 * An in-memory `TaskStore` for the command unit tests, so the status machine and
 * the commands are exercised without a database (the `close`/`documents`
 * test-support precedent). It models the **port** contract in the one status
 * vocabulary the schema stores — there is no translation anywhere.
 */
export interface InMemoryTaskStore extends TaskStore {
  readonly audits: AuditInput[];
  readonly tasks: Map<string, TaskRecord>;
  readonly users: readonly AssignableUser[];
}

export interface InMemoryTaskStoreSeed {
  readonly tasks?: readonly TaskRecord[];
  readonly users?: readonly AssignableUser[];
}

export function createInMemoryTaskStore(seed: InMemoryTaskStoreSeed = {}): InMemoryTaskStore {
  const tasks = new Map<string, TaskRecord>();
  for (const task of seed.tasks ?? []) {
    tasks.set(task.id, task);
  }
  const audits: AuditInput[] = [];

  const store: InMemoryTaskStore = {
    audits,
    tasks,
    users: seed.users ?? [],
    withTransaction: (fn) => fn(store),
    writeAudit: async (input) => {
      audits.push(input);
    },
    createTask: async (input: NewTaskRecord) => {
      const now = new Date().toISOString();
      const task: TaskRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        type: input.type,
        linkedEntityType: input.linkedEntityType,
        linkedEntityId: input.linkedEntityId,
        ownerId: input.ownerId,
        dueDate: input.dueDate,
        priority: input.priority,
        status: "open",
        resolution: null,
        createdAt: now,
        updatedAt: null,
      };
      tasks.set(task.id, task);
      return task;
    },
    findTask: async ({ organizationId, taskId }) => {
      const task = tasks.get(taskId);
      return task !== undefined && task.organizationId === organizationId ? task : undefined;
    },
    listTasks: async (query: TaskListQuery) => {
      const rows = [...tasks.values()]
        .filter((task) => task.organizationId === query.organizationId)
        .filter((task) => query.status === undefined || task.status === query.status)
        .filter((task) => query.ownerId === undefined || task.ownerId === query.ownerId)
        .filter(
          (task) =>
            query.dueBefore === undefined ||
            (task.dueDate !== null && task.dueDate <= query.dueBefore),
        )
        .sort((a, b) => {
          const aDue = a.dueDate ?? "\uffff";
          const bDue = b.dueDate ?? "\uffff";
          if (aDue !== bDue) return aDue < bDue ? -1 : 1;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
      const offset = query.offset ?? 0;
      const limit = query.limit ?? rows.length;
      return rows.slice(offset, offset + limit);
    },
    updateTask: async (input: UpdateTaskRecord) => {
      const existing = tasks.get(input.taskId);
      if (existing === undefined || existing.organizationId !== input.organizationId) {
        return undefined;
      }
      const updated: TaskRecord = {
        ...existing,
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
        updatedAt: new Date().toISOString(),
      };
      tasks.set(updated.id, updated);
      return updated;
    },
    transitionTaskStatus: async (input: TransitionTaskStatusRecord) => {
      const existing = tasks.get(input.taskId);
      if (
        existing === undefined ||
        existing.organizationId !== input.organizationId ||
        existing.status !== input.fromStatus
      ) {
        return undefined;
      }
      const updated: TaskRecord = {
        ...existing,
        status: input.toStatus,
        updatedAt: new Date().toISOString(),
      };
      tasks.set(updated.id, updated);
      return updated;
    },
    listAssignableUsers: async () => store.users,
  };

  return store;
}

/** A fully-populated task row for tests, overridable field by field. */
export function taskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: randomUUID(),
    organizationId: "org-1",
    type: "follow_up",
    linkedEntityType: null,
    linkedEntityId: null,
    ownerId: null,
    dueDate: null,
    priority: "normal",
    status: "open",
    resolution: null,
    createdAt: "2026-09-24T09:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}
