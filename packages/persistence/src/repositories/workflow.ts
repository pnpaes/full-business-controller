import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";

import type { Database } from "../client";
import { approval, task } from "../schema";

export type Task = typeof task.$inferSelect;
export type Approval = typeof approval.$inferSelect;

/*
 * `DEC-094` (the schema-only workflow platform): the `task` and `approval`
 * repositories.
 *
 * Both tables carry `organization_id` directly, so every read and write that
 * takes the organization is scoped by it (`DEC-061`). A row in another
 * organization is invisible at this scope: reads and updates match on `id`
 * **and** `organization_id`, and a scoped miss returns `undefined` rather than
 * surfacing another tenant's row.
 *
 * `task` is mutable (`updateTask`): its `type`/`priority`/`status` are free-text
 * or vocabulary-checked columns and the nullable `owner_id`, `due_date`,
 * `linked_entity_type`/`linked_entity_id` and `resolution` may be set or cleared
 * (`task_linked_entity_check` keeps the link pair all-or-nothing). `approval` is
 * decided once (`decideApproval`): the `decided_by`/`decided_at`/`decision`
 * triple is written together (`approval_decided_check`) and a pending approval is
 * `decision is null`. The `job` table, the worker/scheduler and the outbox layer
 * are deliberately not built (`ADR-0004` gated, `DEC-094`), so
 * `created_from_event_id` is a plain uuid.
 */

export interface CreateTaskInput {
  readonly organizationId: string;
  /** Free text; the spec defines no vocabulary for a task type. */
  readonly type: string;
  /** Polymorphic link pair; either both set or both null. */
  readonly linkedEntityType?: string | null;
  readonly linkedEntityId?: string | null;
  /** Plain uuid; the `app_user` FK is deferred repo-wide. */
  readonly ownerId?: string | null;
  /** `date`, `yyyy-mm-dd`. */
  readonly dueDate?: string | null;
  /** Free text; the spec defines no vocabulary for a task priority. */
  readonly priority: string;
  /** Checked against the `TASK_STATUS` vocabulary; defaults to `open`. */
  readonly status?: string;
  readonly resolution?: string | null;
  /** Plain uuid until the outbox/job layer exists (`ADR-0004` gated). */
  readonly createdFromEventId?: string | null;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly createdBy?: string | null;
}

/** Creates one task row. `organizationId` is supplied by the caller. */
export async function createTask(db: Database, input: CreateTaskInput): Promise<Task> {
  const rows = await db
    .insert(task)
    .values({
      organizationId: input.organizationId,
      type: input.type,
      linkedEntityType: input.linkedEntityType ?? null,
      linkedEntityId: input.linkedEntityId ?? null,
      ownerId: input.ownerId ?? null,
      dueDate: input.dueDate ?? null,
      priority: input.priority,
      ...(input.status === undefined ? {} : { status: input.status }),
      resolution: input.resolution ?? null,
      createdFromEventId: input.createdFromEventId ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindTaskQuery {
  readonly organizationId: string;
  readonly taskId: string;
}

/** One task by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findTask(db: Database, query: FindTaskQuery): Promise<Task | undefined> {
  const rows = await db
    .select()
    .from(task)
    .where(and(eq(task.id, query.taskId), eq(task.organizationId, query.organizationId)))
    .limit(1);
  return rows[0];
}

export interface UpdateTaskInput {
  // `created_from_event_id` is set at creation and deliberately not exposed on
  // the update patch (immutable provenance field).
  readonly organizationId: string;
  readonly taskId: string;
  readonly type?: string;
  readonly linkedEntityType?: string | null;
  readonly linkedEntityId?: string | null;
  readonly ownerId?: string | null;
  readonly dueDate?: string | null;
  readonly priority?: string;
  readonly status?: string;
  readonly resolution?: string | null;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string;
}

/**
 * Updates one task row's mutable fields, organization-scoped (`DEC-061`). A
 * field left out of the patch is untouched (drizzle skips `undefined`), while an
 * explicit value replaces it and an explicit `null` clears a nullable field; the
 * audit columns record the amendment. A missing or cross-organization id returns
 * `undefined`, exactly like `findTask`.
 */
export async function updateTask(db: Database, input: UpdateTaskInput): Promise<Task | undefined> {
  const { organizationId, taskId, actorId, ...patch } = input;
  const rows = await db
    .update(task)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(and(eq(task.id, taskId), eq(task.organizationId, organizationId)))
    .returning();
  return rows[0];
}

export interface UpdateTaskStatusIfCurrentInput {
  readonly organizationId: string;
  readonly taskId: string;
  /** The status the caller observed; the update matches only this value. */
  readonly fromStatus: string;
  readonly toStatus: string;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string;
}

/**
 * The compare-and-set twin of `updateTask` for the `DEC-122` transition guard:
 * writes `to_status` **only** when the stored status still equals `fromStatus`,
 * organization-scoped (`DEC-061`). A concurrent transition that already moved the
 * row updates nothing and returns `undefined`, so two racing transitions cannot
 * both pass the application guard and both write. The statuses are stored values
 * (the adapter owns the domain↔stored translation).
 */
export async function updateTaskStatusIfCurrent(
  db: Database,
  input: UpdateTaskStatusIfCurrentInput,
): Promise<Task | undefined> {
  const { organizationId, taskId, fromStatus, toStatus, actorId } = input;
  const rows = await db
    .update(task)
    .set({
      status: toStatus,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(
      and(
        eq(task.id, taskId),
        eq(task.organizationId, organizationId),
        eq(task.status, fromStatus),
      ),
    )
    .returning();
  return rows[0];
}

export interface ListTasksQuery {
  readonly organizationId: string;
  readonly status?: string;
  readonly ownerId?: string;
  readonly linkedEntityType?: string;
  readonly linkedEntityId?: string;
  /** Inclusive upper bound on `due_date` (`yyyy-mm-dd`). */
  readonly dueBefore?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Task rows for one organization, ordered by `due_date` (then `id`) — Postgres
 * sorts `ASC` as `NULLS LAST`, so undated tasks come after dated ones — with
 * optional status/owner/linked-entity/due-before filters. The organization filter
 * is never optional (`DEC-061`); paging is applied after the ordering.
 */
export async function listTasks(db: Database, query: ListTasksQuery): Promise<readonly Task[]> {
  const statement = db
    .select()
    .from(task)
    .where(
      and(
        eq(task.organizationId, query.organizationId),
        query.status === undefined ? undefined : eq(task.status, query.status),
        query.ownerId === undefined ? undefined : eq(task.ownerId, query.ownerId),
        query.linkedEntityType === undefined
          ? undefined
          : eq(task.linkedEntityType, query.linkedEntityType),
        query.linkedEntityId === undefined
          ? undefined
          : eq(task.linkedEntityId, query.linkedEntityId),
        query.dueBefore === undefined ? undefined : lte(task.dueDate, query.dueBefore),
      ),
    )
    .orderBy(asc(task.dueDate), asc(task.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface CreateApprovalInput {
  readonly organizationId: string;
  /** Polymorphic target type; free text (no vocabulary in the spec). */
  readonly entityType: string;
  /** Polymorphic target id; a plain uuid, no FK. */
  readonly entityId: string;
  /** The approved entity's version, matching `audit_event.entity_version`. */
  readonly entityVersion?: number | null;
  /** Plain uuid; the `app_user` FK is deferred repo-wide. */
  readonly requestedBy: string;
  readonly requestedAt: Date;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly createdBy?: string | null;
}

/** Creates one approval row, undecided (`decision is null`) unless set later. */
export async function createApproval(db: Database, input: CreateApprovalInput): Promise<Approval> {
  const rows = await db
    .insert(approval)
    .values({
      organizationId: input.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      entityVersion: input.entityVersion ?? null,
      requestedBy: input.requestedBy,
      requestedAt: input.requestedAt,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindApprovalQuery {
  readonly organizationId: string;
  readonly approvalId: string;
}

/** One approval by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findApproval(
  db: Database,
  query: FindApprovalQuery,
): Promise<Approval | undefined> {
  const rows = await db
    .select()
    .from(approval)
    .where(
      and(eq(approval.id, query.approvalId), eq(approval.organizationId, query.organizationId)),
    )
    .limit(1);
  return rows[0];
}

export interface DecideApprovalInput {
  readonly organizationId: string;
  readonly approvalId: string;
  /** Checked against the `APPROVAL_DECISION` vocabulary. */
  readonly decision: string;
  /** Plain uuid; the `app_user` FK is deferred repo-wide. */
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly comment?: string | null;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string;
}

/**
 * Decides one approval, organization-scoped (`DEC-061`), enforcing the
 * decide-once rule at the write: the `WHERE` matches only a still-pending row
 * (`decision is null`), so it writes the all-or-nothing
 * `decided_by`/`decided_at`/`decision` triple (the `approval_decided_check`
 * requires all three or none) plus the optional `comment` and the audit columns
 * exactly once. A re-decide therefore updates no row and returns `undefined` —
 * deliberately indistinguishable from a missing or cross-organization id, since
 * both are a scoped miss.
 */
export async function decideApproval(
  db: Database,
  input: DecideApprovalInput,
): Promise<Approval | undefined> {
  const { organizationId, approvalId, actorId, ...patch } = input;
  const rows = await db
    .update(approval)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(
      and(
        eq(approval.id, approvalId),
        eq(approval.organizationId, organizationId),
        isNull(approval.decision),
      ),
    )
    .returning();
  return rows[0];
}

export interface ListApprovalsQuery {
  readonly organizationId: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly decision?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Approval rows for one organization, newest `requested_at` first (then `id`),
 * with optional entity-type/entity-id/decision filters. The organization filter
 * is never optional (`DEC-061`); paging is applied after the ordering.
 */
export async function listApprovals(
  db: Database,
  query: ListApprovalsQuery,
): Promise<readonly Approval[]> {
  const statement = db
    .select()
    .from(approval)
    .where(
      and(
        eq(approval.organizationId, query.organizationId),
        query.entityType === undefined ? undefined : eq(approval.entityType, query.entityType),
        query.entityId === undefined ? undefined : eq(approval.entityId, query.entityId),
        query.decision === undefined ? undefined : eq(approval.decision, query.decision),
      ),
    )
    .orderBy(desc(approval.requestedAt), asc(approval.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
