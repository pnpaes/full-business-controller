import type { AuditInput } from "../auth";

import type { TaskStatus } from "./status-machine";

/**
 * Application-level ports and DTOs for the minimal task workflow (`DEC-122`).
 *
 * `task` carries `organization_id` directly, so every read and write takes the
 * organization and is scoped by it (`DEC-061`); a row in another organization is
 * invisible at this scope. `due_date` crosses the port as a `YYYY-MM-DD` string
 * and the instants (`createdAt`/`updatedAt`) as ISO strings.
 *
 * `status` is carried as the single schema vocabulary
 * (`open`/`in_progress`/`blocked`/`resolved`/`dismissed`, `status-machine.ts`) —
 * the exact values `task_status_check` permits, so no translation happens at any
 * boundary.
 *
 * `approval` is deliberately **not** part of this port: `DEC-122` keeps
 * `approval`'s decide-once semantics untouched and does not link `task`↔
 * `approval` (the recorded `HMS-001` conflict stays open).
 */

/** One `task` row. `status` is one of `TASK_STATUSES`; dates are `YYYY-MM-DD`, instants ISO. */
export interface TaskRecord {
  readonly id: string;
  readonly organizationId: string;
  /** Free text; the spec defines no vocabulary for a task type (`DEC-101`). */
  readonly type: string;
  /** Polymorphic link pair; both set or both null (`task_linked_entity_check`). */
  readonly linkedEntityType: string | null;
  readonly linkedEntityId: string | null;
  /** Plain uuid; the `app_user` FK is deferred repo-wide. */
  readonly ownerId: string | null;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly dueDate: string | null;
  /** Free text; the spec defines no vocabulary for a task priority (`DEC-101`). */
  readonly priority: string;
  /** One of `TASK_STATUSES` (domain vocabulary). */
  readonly status: string;
  readonly resolution: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  /** `timestamptz`, ISO; null before any update. */
  readonly updatedAt: string | null;
}

/** A task to create. The status is always `open` (the machine's only entry state). */
export interface NewTaskRecord {
  readonly organizationId: string;
  readonly type: string;
  readonly priority: string;
  readonly dueDate: string | null;
  readonly ownerId: string | null;
  readonly linkedEntityType: string | null;
  readonly linkedEntityId: string | null;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/**
 * A patch to one task. `undefined` means "leave as is"; an explicit `null`
 * clears a nullable field. `type`/`priority`/`dueDate`/link fields are not
 * exposed here — this slice only amends the assignee and the status.
 */
export interface UpdateTaskRecord {
  readonly organizationId: string;
  readonly taskId: string;
  /** One of `TASK_STATUSES` (domain vocabulary). */
  readonly status?: string;
  readonly ownerId?: string | null;
  /** The acting actor; recorded as `updated_by`. */
  readonly actorId?: string | null;
}

/**
 * A conditional status write: updates the row only when its stored status is
 * still `fromStatus`, so two concurrent transitions cannot both pass the guard
 * and both write (the close slice's `SELECT … FOR UPDATE` equivalent, expressed
 * as an atomic compare-and-set). `undefined` means the row moved (or vanished).
 */
export interface TransitionTaskStatusRecord {
  readonly organizationId: string;
  readonly taskId: string;
  /** One of `TASK_STATUSES`; the status observed by the guard. */
  readonly fromStatus: string;
  /** One of `TASK_STATUSES`; the status to write. */
  readonly toStatus: string;
  readonly actorId: string | null;
}

/** Task filters for the store read. */
export interface TaskListQuery {
  readonly organizationId: string;
  /** One of `TASK_STATUSES`, exact match. */
  readonly status?: string;
  readonly ownerId?: string;
  /** Inclusive upper bound on `due_date`; `YYYY-MM-DD`. */
  readonly dueBefore?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * A candidate assignee: an active `app_user` reduced to the three fields a
 * picker needs (`DEC-122`). No role/scope filtering — the picker offers every
 * active user in the organization, the smallest honest read.
 */
export interface AssignableUser {
  readonly id: string;
  readonly displayName: string;
  readonly username: string | null;
}

/**
 * The persistence port for the task slice. One port covers the one table plus
 * the minimal active-`app_user` read that backs the assignee picker. The port is
 * expressed in the `task_status_check` vocabulary; the adapter stores those
 * values verbatim.
 */
export interface TaskStore {
  /**
   * Binds `fn` to one transaction so a write and its audit fact commit or roll
   * back together.
   */
  withTransaction<T>(fn: (store: TaskStore) => Promise<T>): Promise<T>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
  createTask(input: NewTaskRecord): Promise<TaskRecord>;
  /** One task by id, organization-scoped (`DEC-061`), or `undefined`. */
  findTask(query: {
    readonly organizationId: string;
    readonly taskId: string;
  }): Promise<TaskRecord | undefined>;
  listTasks(query: TaskListQuery): Promise<readonly TaskRecord[]>;
  /**
   * Applies a patch (assignee and/or status), organization-scoped (`DEC-061`);
   * `undefined` when no row matches in the organization.
   */
  updateTask(input: UpdateTaskRecord): Promise<TaskRecord | undefined>;
  /** Atomic compare-and-set on the status; `undefined` when the row has moved. */
  transitionTaskStatus(input: TransitionTaskStatusRecord): Promise<TaskRecord | undefined>;
  /** Active `app_user` rows in the organization, for the assignee picker. */
  listAssignableUsers(query: {
    readonly organizationId: string;
  }): Promise<readonly AssignableUser[]>;
}

/** The `TASK_STATUSES` vocabulary, re-exported for the row parsers/mappers. */
export type { TaskStatus };
