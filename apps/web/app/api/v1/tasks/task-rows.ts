import {
  DEFAULT_TASK_LIMIT,
  TASK_STATUSES,
  type AssignableUser,
  type TaskRecord,
} from "@aquarela/application";

/**
 * Pure query/body parsing and response mapping for the task routes (`DEC-122`).
 * Kept free of Next, DB and I/O imports so the routes do the reads and hand the
 * application results to the row mappers.
 *
 * Shape checks only where a value would otherwise reach a Postgres column: the
 * `status` vocabulary (the application's `TASK_STATUSES`), UUIDs and calendar
 * dates. The row mappers drop a foreign-organization row defensively, like the
 * other slices, even though the application reads are already organization-scoped
 * (`DEC-061`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 200;
const MAX_TEXT = 200;
const MAX_VOCAB = 32;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** True when `value` is a real `YYYY-MM-DD` day (`date` column shaped). */
function isDate(value: string): boolean {
  if (!DATE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function readPositiveInteger(raw: string | null): number | undefined | "invalid" {
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    return "invalid";
  }
  return Number.parseInt(value, 10);
}

/** Parses `limit`/`offset`; both are bounded so a huge `offset` cannot reach the store. */
function readPaging(
  searchParams: URLSearchParams,
): { readonly ok: true; readonly limit: number; readonly offset: number } | { readonly ok: false } {
  const limit = readPositiveInteger(searchParams.get("limit"));
  const offset = readPositiveInteger(searchParams.get("offset"));
  if (limit === "invalid" || offset === "invalid") {
    return { ok: false };
  }
  if (limit !== undefined && (limit < 1 || limit > MAX_LIMIT)) {
    return { ok: false };
  }
  if (offset !== undefined && offset > MAX_LIMIT) {
    return { ok: false };
  }
  return { ok: true, limit: limit ?? DEFAULT_TASK_LIMIT, offset: offset ?? 0 };
}

function readVocabFilter(
  searchParams: URLSearchParams,
  key: string,
  values: readonly string[],
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 && value.length <= MAX_VOCAB && values.includes(value)
    ? value
    : "invalid";
}

function readUuidFilter(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return isUuid(value) ? value : "invalid";
}

function readDateFilter(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 && isDate(value) ? value : "invalid";
}

function readText(body: Record<string, unknown>, key: string, max = MAX_TEXT): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function readVocab(
  body: Record<string, unknown>,
  key: string,
  values: readonly string[],
): string | null {
  const value = readText(body, key, MAX_VOCAB);
  return value !== null && values.includes(value) ? value : null;
}

/** Optional free text: absent → not present; null/blank → `null`; over-long → invalid. */
function readOptionalText(
  body: Record<string, unknown>,
  key: string,
  max = MAX_TEXT,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  const value = body[key];
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string" || value.length > max) {
    return { ok: false };
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

/** Optional uuid: absent → not present; null/blank → `null`; non-uuid → invalid. */
function readOptionalUuid(
  body: Record<string, unknown>,
  key: string,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  const value = body[key];
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  return isUuid(trimmed) ? { ok: true, value: trimmed } : { ok: false };
}

/** Optional `YYYY-MM-DD`: absent → not present; null/blank → `null`; malformed → invalid. */
function readOptionalDate(
  body: Record<string, unknown>,
  key: string,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  const value = body[key];
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  return isDate(trimmed) ? { ok: true, value: trimmed } : { ok: false };
}

/* --------------------------------- queries -------------------------------- */

export interface TaskListQuery {
  /** One of `TASK_STATUSES`, exact match. */
  readonly status?: string;
  readonly ownerId?: string;
  /** Inclusive upper bound on `dueDate`; a `YYYY-MM-DD` day. */
  readonly dueBefore?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedTaskListQuery =
  { readonly ok: true; readonly query: TaskListQuery } | { readonly ok: false };

/** Parses the optional `status`/`ownerId`/`dueBefore` filters and paging. */
export function parseTaskListQuery(searchParams: URLSearchParams): ParsedTaskListQuery {
  const status = readVocabFilter(searchParams, "status", TASK_STATUSES);
  if (status === "invalid") {
    return { ok: false };
  }
  const ownerId = readUuidFilter(searchParams, "ownerId");
  if (ownerId === "invalid") {
    return { ok: false };
  }
  const dueBefore = readDateFilter(searchParams, "dueBefore");
  if (dueBefore === "invalid") {
    return { ok: false };
  }
  const paging = readPaging(searchParams);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(status === undefined ? {} : { status }),
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(dueBefore === undefined ? {} : { dueBefore }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

/* -------------------------------- bodies ---------------------------------- */

export interface CreateTaskBody {
  readonly type: string;
  readonly priority: string;
  readonly dueDate: string | null;
  readonly ownerId: string | null;
  readonly linkedEntityType: string | null;
  readonly linkedEntityId: string | null;
}

export type ParsedCreateTask =
  { readonly ok: true; readonly input: CreateTaskBody } | { readonly ok: false };

/** `POST /tasks` body: the identity, priority, optional due date/assignee/link of a new task. */
export function parseCreateTaskBody(body: Record<string, unknown> | undefined): ParsedCreateTask {
  if (body === undefined) {
    return { ok: false };
  }
  const type = readText(body, "type");
  const priority = readText(body, "priority");
  if (type === null || priority === null) {
    return { ok: false };
  }
  const dueDate = readOptionalDate(body, "dueDate");
  const ownerId = readOptionalUuid(body, "ownerId");
  const linkedEntityType = readOptionalText(body, "linkedEntityType");
  const linkedEntityId = readOptionalUuid(body, "linkedEntityId");
  if (!dueDate.ok || !ownerId.ok || !linkedEntityType.ok || !linkedEntityId.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      type,
      priority,
      dueDate: dueDate.value,
      ownerId: ownerId.value,
      linkedEntityType: linkedEntityType.value,
      linkedEntityId: linkedEntityId.value,
    },
  };
}

export interface TransitionTaskBody {
  /** One of `TASK_STATUSES`. */
  readonly status: string;
}

export type ParsedTransitionTask =
  { readonly ok: true; readonly input: TransitionTaskBody } | { readonly ok: false };

/** `POST /tasks/[id]/transition` body: the single target status. */
export function parseTransitionTaskBody(
  body: Record<string, unknown> | undefined,
): ParsedTransitionTask {
  if (body === undefined) {
    return { ok: false };
  }
  const status = readVocab(body, "status", TASK_STATUSES);
  return status === null ? { ok: false } : { ok: true, input: { status } };
}

export interface AssignTaskBody {
  /** The new assignee, or null to unassign. */
  readonly ownerId: string | null;
}

export type ParsedAssignTask =
  { readonly ok: true; readonly input: AssignTaskBody } | { readonly ok: false };

/** `POST /tasks/[id]/assign` body: a uuid to assign or an explicit null to clear. */
export function parseAssignTaskBody(body: Record<string, unknown> | undefined): ParsedAssignTask {
  if (body === undefined || !("ownerId" in body)) {
    return { ok: false };
  }
  const ownerId = readOptionalUuid(body, "ownerId");
  return ownerId.ok ? { ok: true, input: { ownerId: ownerId.value } } : { ok: false };
}

/* ------------------------------ response rows ----------------------------- */

export interface TaskRow {
  readonly id: string;
  readonly type: string;
  readonly priority: string;
  readonly status: string;
  readonly ownerId: string | null;
  readonly dueDate: string | null;
  readonly linkedEntityType: string | null;
  readonly linkedEntityId: string | null;
  readonly resolution: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

/** Maps one task to an HTTP row; `undefined` for a foreign-organization row. */
export function toTaskRow(organizationId: string, task: TaskRecord): TaskRow | undefined {
  if (task.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: task.id,
    type: task.type,
    priority: task.priority,
    status: task.status,
    ownerId: task.ownerId,
    dueDate: task.dueDate,
    linkedEntityType: task.linkedEntityType,
    linkedEntityId: task.linkedEntityId,
    resolution: task.resolution,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/** Maps task records to HTTP rows, dropping any foreign-organization task. */
export function toTaskRows(
  organizationId: string,
  tasks: readonly TaskRecord[],
): readonly TaskRow[] {
  const rows: TaskRow[] = [];
  for (const task of tasks) {
    const row = toTaskRow(organizationId, task);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export interface AssignableUserRow {
  readonly id: string;
  readonly displayName: string;
  readonly username: string | null;
}

/** Maps the assignable-user records to HTTP rows. */
export function toAssignableUserRows(
  users: readonly AssignableUser[],
): readonly AssignableUserRow[] {
  return users.map((user) => ({
    id: user.id,
    displayName: user.displayName,
    username: user.username,
  }));
}
