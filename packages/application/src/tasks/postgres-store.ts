import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  NewTaskRecord,
  TaskListQuery,
  TaskRecord,
  TaskStore,
  TransitionTaskStatusRecord,
  UpdateTaskRecord,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/** `timestamptz`, ISO, or `null` — the adapter's read-side convention. */
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function toTask(row: repo.Task): TaskRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    type: row.type,
    linkedEntityType: row.linkedEntityType,
    linkedEntityId: row.linkedEntityId,
    ownerId: row.ownerId,
    dueDate: row.dueDate,
    priority: row.priority,
    status: row.status,
    resolution: row.resolution,
    createdAt: row.createdAt.toISOString(),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * Adapts the persistence task repository to the `TaskStore` port: the
 * `timestamptz` columns become ISO strings on read, the `date` column is already
 * `YYYY-MM-DD`, and `status` uses the single vocabulary the table stores — the
 * `task_status_check` values (`open, in_progress, blocked, resolved, dismissed`),
 * with no translation at any boundary. Every read/write passes the organization
 * through, so the adapter cannot escape the `DEC-061` row scope. The
 * assignable-user read delegates to the persistence `app_user` read,
 * organization-scoped.
 */
export function createPostgresTaskStore(db: Database): TaskStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresTaskStore(db));
      }
      return db.transaction((tx) => fn(createPostgresTaskStore(tx)));
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
    createTask: async (input: NewTaskRecord) =>
      toTask(
        await repo.createTask(db, {
          organizationId: input.organizationId,
          type: input.type,
          priority: input.priority,
          dueDate: input.dueDate,
          ownerId: input.ownerId,
          linkedEntityType: input.linkedEntityType,
          linkedEntityId: input.linkedEntityId,
          createdBy: input.createdBy,
        }),
      ),
    findTask: async (query) => {
      const row = await repo.findTask(db, {
        organizationId: query.organizationId,
        taskId: query.taskId,
      });
      return row === undefined ? undefined : toTask(row);
    },
    listTasks: async (query: TaskListQuery) => {
      const rows = await repo.listTasks(db, {
        organizationId: query.organizationId,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.ownerId === undefined ? {} : { ownerId: query.ownerId }),
        ...(query.dueBefore === undefined ? {} : { dueBefore: query.dueBefore }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toTask);
    },
    updateTask: async (input: UpdateTaskRecord) => {
      const row = await repo.updateTask(db, {
        organizationId: input.organizationId,
        taskId: input.taskId,
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
        ...(typeof input.actorId === "string" ? { actorId: input.actorId } : {}),
      });
      return row === undefined ? undefined : toTask(row);
    },
    transitionTaskStatus: async (input: TransitionTaskStatusRecord) => {
      const row = await repo.updateTaskStatusIfCurrent(db, {
        organizationId: input.organizationId,
        taskId: input.taskId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        ...(input.actorId === null ? {} : { actorId: input.actorId }),
      });
      return row === undefined ? undefined : toTask(row);
    },
    listAssignableUsers: async (query) => repo.listAssignableUsers(db, query.organizationId),
  };
}
