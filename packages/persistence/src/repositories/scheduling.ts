import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import type { Database } from "../client";
import {
  employee,
  payrollReport,
  position,
  shift,
  shiftAdjustment,
  shiftAssignment,
} from "../schema";

export type Shift = typeof shift.$inferSelect;
export type ShiftAssignment = typeof shiftAssignment.$inferSelect;
export type ShiftAdjustment = typeof shiftAdjustment.$inferSelect;
export type PayrollReport = typeof payrollReport.$inferSelect;

/*
 * `DEC-037`/`DEC-038` (`WF-002`, `WF-003`): the shift-scheduling slice.
 *
 * Both tables carry `organization_id` directly, so every read and write that
 * takes the organization is scoped by it (`DEC-061`). A row in another
 * organization is invisible at this scope: reads and updates match on `id`
 * **and** `organization_id`, and a scoped miss returns `undefined` rather than
 * surfacing another tenant's row. A shift is additionally **location-scoped**
 * (`location_id`, NOT NULL); assignments link a shift to an employee, and the
 * `0052` guard triggers keep both references in the row's own organization.
 *
 * `shift` is the mutable parent (`updateShift`): `state` is checked against the
 * `SHIFT_STATE` vocabulary (its transitions are documented provisionally, see
 * `DEC-102`), `roleCode` is free text with null meaning "any role", and
 * `publishedAt` is set when the shift is published. `shiftAssignment` records
 * one employee's assignment to one shift (`state` checked against
 * `SHIFT_ASSIGNMENT_STATE`); `assignedBy` is null for a self-assignment. Both
 * tables carry the standard `auditColumns()`, and `createdBy`/`actorId` are
 * recorded as plain uuids (the `app_user` FK is deferred repo-wide).
 *
 * This layer exposes **no delete command** and writes **no** `audit_event`
 * (neither table is append-only). Worked hours (`shift_adjustment`, `WF-004`) are
 * modelled below as append-only correction facts; the monthly payroll-input
 * report (`payroll_report`, `WF-005`, `DEC-037`) is modelled below as a small
 * mutable report row whose `snapshot` freezes the lines it was generated from.
 *
 * The vocabulary columns, the `ends_at > starts_at` / `break_minutes >= 0` /
 * actual-range checks, the `(shift_id, employee_id)` unique and the
 * cross-organization guards are database-backed, so this layer does not
 * re-validate them; the application validates first so callers see a
 * `DomainError`.
 */

export interface CreateShiftInput {
  readonly organizationId: string;
  /** NOT NULL FK to `location.id`; guarded same-organization by `0052`. */
  readonly locationId: string;
  /** Free text; retained for now (`DEC-151` expand-only), superseded by `positionId`. */
  readonly roleCode?: string | null;
  /** `DEC-151` staffing match; `null` means any position. */
  readonly positionId?: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** Defaults to 0 at the database; must be `>= 0`. */
  readonly breakMinutes?: number;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly createdBy?: string | null;
}

/** Creates one shift row. `organizationId` is supplied by the caller. */
export async function createShift(db: Database, input: CreateShiftInput): Promise<Shift> {
  const rows = await db
    .insert(shift)
    .values({
      organizationId: input.organizationId,
      locationId: input.locationId,
      roleCode: input.roleCode ?? null,
      positionId: input.positionId ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      ...(input.breakMinutes === undefined ? {} : { breakMinutes: input.breakMinutes }),
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindShiftQuery {
  readonly organizationId: string;
  readonly shiftId: string;
}

/** One shift by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findShift(db: Database, query: FindShiftQuery): Promise<Shift | undefined> {
  const rows = await db
    .select()
    .from(shift)
    .where(and(eq(shift.id, query.shiftId), eq(shift.organizationId, query.organizationId)))
    .limit(1);
  return rows[0];
}

/**
 * The same org-scoped select as `findShift`, but taking the row's write lock
 * (`SELECT … FOR UPDATE`) for the rest of the surrounding transaction. A missing
 * or cross-organization id returns `undefined` without locking anything. The
 * commands that derive assignment state from the shift's current assignments
 * call this first, so concurrent transactions against one shift serialise
 * instead of colliding on the `(shift_id, employee_id)` unique (23505).
 */
export async function lockShift(db: Database, query: FindShiftQuery): Promise<Shift | undefined> {
  const rows = await db
    .select()
    .from(shift)
    .where(and(eq(shift.id, query.shiftId), eq(shift.organizationId, query.organizationId)))
    .for("update")
    .limit(1);
  return rows[0];
}

export interface UpdateShiftInput {
  readonly organizationId: string;
  readonly shiftId: string;
  readonly startsAt?: Date;
  readonly endsAt?: Date;
  readonly breakMinutes?: number;
  /** Explicit `null` clears the role (any role); an omitted field is untouched. */
  readonly roleCode?: string | null;
  /** `DEC-151`: explicit `null` means any position; omitted leaves it untouched. */
  readonly positionId?: string | null;
  /** Checked against the `SHIFT_STATE` vocabulary. */
  readonly state?: string;
  /** Set when published; an explicit `null` clears it. */
  readonly publishedAt?: Date | null;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/**
 * Updates one shift row's mutable fields, organization-scoped (`DEC-061`).
 * A field left out of the patch is untouched (drizzle skips `undefined`), while
 * an explicit value replaces it and an explicit `null` clears a nullable column;
 * the audit columns record the amendment. `locationId` is immutable after
 * creation, and the id alone cannot address another tenant's row — a missing or
 * cross-organization id returns `undefined`, exactly like `findShift`.
 */
export async function updateShift(
  db: Database,
  input: UpdateShiftInput,
): Promise<Shift | undefined> {
  const { organizationId, shiftId, actorId, ...patch } = input;
  const rows = await db
    .update(shift)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(and(eq(shift.id, shiftId), eq(shift.organizationId, organizationId)))
    .returning();
  return rows[0];
}

export interface ListShiftsQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  /** Checked against the `SHIFT_STATE` vocabulary. */
  readonly state?: string;
  /** Inclusive lower bound on `starts_at` (`>= from`). */
  readonly from?: Date;
  /** Inclusive upper bound on `starts_at` (`<= to`). */
  readonly to?: Date;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Shift rows for one organization, ordered by `startsAt` (then `id`), with
 * optional location, state and `startsAt` window filters (`from` inclusive
 * lower bound, `to` inclusive upper bound). The organization filter is never
 * optional (`DEC-061`); paging is applied after the ordering.
 */
export async function listShifts(db: Database, query: ListShiftsQuery): Promise<readonly Shift[]> {
  const statement = db
    .select()
    .from(shift)
    .where(
      and(
        eq(shift.organizationId, query.organizationId),
        query.locationId === undefined ? undefined : eq(shift.locationId, query.locationId),
        query.state === undefined ? undefined : eq(shift.state, query.state),
        query.from === undefined ? undefined : gte(shift.startsAt, query.from),
        query.to === undefined ? undefined : lte(shift.startsAt, query.to),
      ),
    )
    .orderBy(asc(shift.startsAt), asc(shift.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface CreateShiftAssignmentInput {
  readonly organizationId: string;
  /** NOT NULL FK to `shift.id`; guarded same-organization by `0052`. */
  readonly shiftId: string;
  /** NOT NULL FK to `employee.id`; guarded same-organization by `0052`. */
  readonly employeeId: string;
  /** Checked against the `SHIFT_ASSIGNMENT_STATE` vocabulary. */
  readonly state: string;
  /** Plain uuid; `null` means self-assigned (the `app_user` FK is deferred). */
  readonly assignedBy?: string | null;
  readonly assignedAt: Date;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly createdBy?: string | null;
}

/** Creates one shift-assignment row. `organizationId` is supplied by the caller. */
export async function createShiftAssignment(
  db: Database,
  input: CreateShiftAssignmentInput,
): Promise<ShiftAssignment> {
  const rows = await db
    .insert(shiftAssignment)
    .values({
      organizationId: input.organizationId,
      shiftId: input.shiftId,
      employeeId: input.employeeId,
      state: input.state,
      assignedBy: input.assignedBy ?? null,
      assignedAt: input.assignedAt,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindShiftAssignmentQuery {
  readonly organizationId: string;
  readonly shiftAssignmentId: string;
}

/** One shift assignment by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findShiftAssignment(
  db: Database,
  query: FindShiftAssignmentQuery,
): Promise<ShiftAssignment | undefined> {
  const rows = await db
    .select()
    .from(shiftAssignment)
    .where(
      and(
        eq(shiftAssignment.id, query.shiftAssignmentId),
        eq(shiftAssignment.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface FindShiftAssignmentByShiftEmployeeQuery {
  readonly organizationId: string;
  readonly shiftId: string;
  readonly employeeId: string;
}

/**
 * One employee's assignment to one shift, organization-scoped (`DEC-061`), or
 * `undefined`. The `(shift_id, employee_id)` unique makes the pair the natural
 * key, so no id is needed.
 */
export async function findShiftAssignmentByShiftEmployee(
  db: Database,
  query: FindShiftAssignmentByShiftEmployeeQuery,
): Promise<ShiftAssignment | undefined> {
  const rows = await db
    .select()
    .from(shiftAssignment)
    .where(
      and(
        eq(shiftAssignment.organizationId, query.organizationId),
        eq(shiftAssignment.shiftId, query.shiftId),
        eq(shiftAssignment.employeeId, query.employeeId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface UpdateShiftAssignmentInput {
  readonly organizationId: string;
  readonly shiftAssignmentId: string;
  /** Checked against the `SHIFT_ASSIGNMENT_STATE` vocabulary. */
  readonly state?: string;
  /**
   * The assigning actor recorded on the row. `null` keeps the self-assignment
   * marker; a manager approval sets it to the deciding actor. Omitted leaves it
   * untouched.
   */
  readonly assignedBy?: string | null;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/**
 * Updates one shift assignment's mutable fields, organization-scoped
 * (`DEC-061`). `shiftId` and `employeeId` are immutable after creation, so an
 * assignment cannot be moved; the audit columns record the amendment. A missing
 * or cross-organization id returns `undefined`, exactly like
 * `findShiftAssignment`.
 */
export async function updateShiftAssignment(
  db: Database,
  input: UpdateShiftAssignmentInput,
): Promise<ShiftAssignment | undefined> {
  const { organizationId, shiftAssignmentId, actorId, ...patch } = input;
  const rows = await db
    .update(shiftAssignment)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(
      and(
        eq(shiftAssignment.id, shiftAssignmentId),
        eq(shiftAssignment.organizationId, organizationId),
      ),
    )
    .returning();
  return rows[0];
}

export interface ListShiftAssignmentsQuery {
  readonly organizationId: string;
  readonly shiftId?: string;
  readonly employeeId?: string;
  /** Checked against the `SHIFT_ASSIGNMENT_STATE` vocabulary. */
  readonly state?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Shift assignments for one organization, ordered by `assignedAt` (then `id`),
 * with optional shift, employee and state filters. The organization filter is
 * never optional (`DEC-061`); paging is applied after the ordering.
 */
export async function listShiftAssignments(
  db: Database,
  query: ListShiftAssignmentsQuery,
): Promise<readonly ShiftAssignment[]> {
  const statement = db
    .select()
    .from(shiftAssignment)
    .where(
      and(
        eq(shiftAssignment.organizationId, query.organizationId),
        query.shiftId === undefined ? undefined : eq(shiftAssignment.shiftId, query.shiftId),
        query.employeeId === undefined
          ? undefined
          : eq(shiftAssignment.employeeId, query.employeeId),
        query.state === undefined ? undefined : eq(shiftAssignment.state, query.state),
      ),
    )
    .orderBy(asc(shiftAssignment.assignedAt), asc(shiftAssignment.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

/** One of `employee`'s own assignments, joined to its shift (`WF-003`). */
export interface MyShiftRow {
  readonly assignmentId: string;
  /** One of `SHIFT_ASSIGNMENT_STATE`. */
  readonly assignmentState: string;
  readonly assignedAt: Date;
  readonly shiftId: string;
  readonly locationId: string;
  readonly roleCode: string | null;
  /** `DEC-151` staffing match; `null` means any position. */
  readonly positionId: string | null;
  readonly positionName: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly breakMinutes: number;
  /** One of `SHIFT_STATE`. */
  readonly shiftState: string;
}

export interface ListMyShiftsQuery {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * One employee's own assignments (`WF-003`, `DEC-146`), joined to their shift,
 * organization-scoped on both sides (`DEC-061`) so the employee link is the
 * only way in. Ordered by `shift.starts_at` then assignment id; paging is
 * applied after the ordering.
 */
export async function listMyShifts(
  db: Database,
  query: ListMyShiftsQuery,
): Promise<readonly MyShiftRow[]> {
  const statement = db
    .select({
      assignmentId: shiftAssignment.id,
      assignmentState: shiftAssignment.state,
      assignedAt: shiftAssignment.assignedAt,
      shiftId: shift.id,
      locationId: shift.locationId,
      roleCode: shift.roleCode,
      positionId: shift.positionId,
      positionName: position.name,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      breakMinutes: shift.breakMinutes,
      shiftState: shift.state,
    })
    .from(shiftAssignment)
    .innerJoin(shift, eq(shiftAssignment.shiftId, shift.id))
    .leftJoin(position, eq(shift.positionId, position.id))
    .where(
      and(
        eq(shiftAssignment.organizationId, query.organizationId),
        eq(shift.organizationId, query.organizationId),
        eq(shiftAssignment.employeeId, query.employeeId),
      ),
    )
    .orderBy(asc(shift.startsAt), asc(shiftAssignment.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

/** One self-originated assignment awaiting a manager decision (`WF-003`). */
export interface PendingSelfAssignmentRow {
  readonly assignmentId: string;
  readonly assignedAt: Date;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly shiftId: string;
  readonly locationId: string;
  readonly roleCode: string | null;
  /** `DEC-151` staffing match; `null` means any position. */
  readonly positionId: string | null;
  readonly positionName: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly breakMinutes: number;
}

export interface ListPendingSelfAssignmentsQuery {
  readonly organizationId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The manager review queue (`WF-003`, `DEC-146`): self-originated
 * (`assigned_by is null`) `pending_approval` assignments joined to their shift
 * and employee, organization-scoped on all three tables (`DEC-061`). Ordered by
 * `shift.starts_at` then assignment id; paging is applied after the ordering.
 */
export async function listPendingSelfAssignments(
  db: Database,
  query: ListPendingSelfAssignmentsQuery,
): Promise<readonly PendingSelfAssignmentRow[]> {
  const statement = db
    .select({
      assignmentId: shiftAssignment.id,
      assignedAt: shiftAssignment.assignedAt,
      employeeId: employee.id,
      employeeName: employee.name,
      shiftId: shift.id,
      locationId: shift.locationId,
      roleCode: shift.roleCode,
      positionId: shift.positionId,
      positionName: position.name,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      breakMinutes: shift.breakMinutes,
    })
    .from(shiftAssignment)
    .innerJoin(shift, eq(shiftAssignment.shiftId, shift.id))
    .innerJoin(employee, eq(shiftAssignment.employeeId, employee.id))
    .leftJoin(position, eq(shift.positionId, position.id))
    .where(
      and(
        eq(shiftAssignment.organizationId, query.organizationId),
        eq(shift.organizationId, query.organizationId),
        eq(employee.organizationId, query.organizationId),
        eq(shiftAssignment.state, "pending_approval"),
        isNull(shiftAssignment.assignedBy),
      ),
    )
    .orderBy(asc(shift.startsAt), asc(shiftAssignment.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

/** One `open`/`published` shift an employee may self-assign (`DEC-151`). */
export interface AvailableShiftRow {
  readonly shiftId: string;
  readonly locationId: string;
  readonly positionId: string | null;
  readonly positionName: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly breakMinutes: number;
  /** One of `SHIFT_STATE`. */
  readonly shiftState: string;
}

export interface ListAvailableShiftsQuery {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly locationId: string;
  /** The employee's held position ids; a shift with no position also matches. */
  readonly positionIds: readonly string[];
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The shifts one employee may self-assign (`DEC-151`): `open`/`published`, at
 * the employee's location, whose position is null (any position) or one the
 * employee holds, and with no assignment yet by that employee. Organization-
 * scoped on the shift and the not-exists subquery (`DEC-061`); ordered by start.
 */
export async function listAvailableShifts(
  db: Database,
  query: ListAvailableShiftsQuery,
): Promise<readonly AvailableShiftRow[]> {
  const positionMatch =
    query.positionIds.length === 0
      ? isNull(shift.positionId)
      : or(isNull(shift.positionId), inArray(shift.positionId, [...query.positionIds]));
  const statement = db
    .select({
      shiftId: shift.id,
      locationId: shift.locationId,
      positionId: shift.positionId,
      positionName: position.name,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      breakMinutes: shift.breakMinutes,
      shiftState: shift.state,
    })
    .from(shift)
    .leftJoin(position, eq(shift.positionId, position.id))
    .where(
      and(
        eq(shift.organizationId, query.organizationId),
        eq(shift.locationId, query.locationId),
        inArray(shift.state, ["open", "published"]),
        positionMatch,
        sql`not exists (
          select 1 from "shift_assignment" sa
          where sa."organization_id" = ${query.organizationId}
            and sa."shift_id" = ${shift.id}
            and sa."employee_id" = ${query.employeeId}
        )`,
      ),
    )
    .orderBy(asc(shift.startsAt), asc(shift.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface CountSelfAssignedShiftsInWeekQuery {
  readonly organizationId: string;
  readonly employeeId: string;
  /** Exclusive upper bound on the shift start (`shift.starts_at < weekEnd`). */
  readonly weekEnd: Date;
  /** Inclusive lower bound on the shift end (`shift.ends_at > weekStart`). */
  readonly weekStart: Date;
}

/**
 * How many of one employee's **self-originated** assignments (`assigned_by is
 * null`) in a live state (`self_assigned`/`pending_approval`/`approved`)
 * overlap the half-open week `[weekStart, weekEnd)`. The weekly self-assignment
 * maximum (`WF-003`, `DEC-146`) counts these. Overlap is
 * `shift.starts_at < weekEnd and shift.ends_at > weekStart`, so a shift that
 * straddles a week boundary counts in each week it touches; the shift and
 * assignment are both organization-scoped (`DEC-061`). `withdrawn`/`rejected`
 * rows are excluded — a reverted request frees its slot.
 */
export async function countSelfAssignedShiftsInWeek(
  db: Database,
  query: CountSelfAssignedShiftsInWeekQuery,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(shiftAssignment)
    .innerJoin(shift, eq(shiftAssignment.shiftId, shift.id))
    .where(
      and(
        eq(shiftAssignment.organizationId, query.organizationId),
        eq(shift.organizationId, query.organizationId),
        eq(shiftAssignment.employeeId, query.employeeId),
        isNull(shiftAssignment.assignedBy),
        inArray(shiftAssignment.state, ["self_assigned", "pending_approval", "approved"]),
        lt(shift.startsAt, query.weekEnd),
        gt(shift.endsAt, query.weekStart),
      ),
    );
  return rows[0]?.value ?? 0;
}

/**
 * Takes the employee row's write lock (`SELECT … FOR UPDATE`) for the rest of
 * the surrounding transaction. `selfAssignShift` calls this after locking the
 * shift and before counting the weekly self-assignments (`WF-003`,
 * `DEC-146`), so concurrent self-assignments by one employee serialise on the
 * employee row and the second transaction counts the first's committed insert.
 * The caller has already resolved the employee organization-scoped, so only
 * `id` is matched; an id with no row locks nothing and returns silently.
 */
export async function lockEmployeeForSelfAssignment(
  db: Database,
  employeeId: string,
): Promise<void> {
  await db
    .select({ id: employee.id })
    .from(employee)
    .where(eq(employee.id, employeeId))
    .for("update");
}

export interface CreateShiftAdjustmentInput {
  readonly organizationId: string;
  /** NOT NULL FK to `shift_assignment.id`; guarded same-organization by `0054`. */
  readonly shiftAssignmentId: string;
  /** Decimal string (`numeric(9,2)`, hours — never a float); must be `>= 0`. */
  readonly adjustedHours: string;
  readonly reason: string;
  /** Plain uuid; the `app_user` FK is deferred. Nullable (unapproved correction). */
  readonly approvedBy?: string | null;
  readonly approvedAt?: Date | null;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly createdBy?: string | null;
}

/**
 * Creates one worked-hours correction row (`WF-004`, `DEC-038`).
 * `organizationId` is supplied by the caller; the `shift_adjustment_approved_check`
 * keeps `approvedBy`/`approvedAt` all-or-nothing and
 * `shift_adjustment_adjusted_hours_check` keeps the hours non-negative.
 */
export async function createShiftAdjustment(
  db: Database,
  input: CreateShiftAdjustmentInput,
): Promise<ShiftAdjustment> {
  const rows = await db
    .insert(shiftAdjustment)
    .values({
      organizationId: input.organizationId,
      shiftAssignmentId: input.shiftAssignmentId,
      adjustedHours: input.adjustedHours,
      reason: input.reason,
      approvedBy: input.approvedBy ?? null,
      approvedAt: input.approvedAt ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindShiftAdjustmentQuery {
  readonly organizationId: string;
  readonly shiftAdjustmentId: string;
}

/** One shift adjustment by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findShiftAdjustment(
  db: Database,
  query: FindShiftAdjustmentQuery,
): Promise<ShiftAdjustment | undefined> {
  const rows = await db
    .select()
    .from(shiftAdjustment)
    .where(
      and(
        eq(shiftAdjustment.id, query.shiftAdjustmentId),
        eq(shiftAdjustment.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListShiftAdjustmentsQuery {
  readonly organizationId: string;
  readonly shiftAssignmentId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Shift adjustments for one organization, newest first (`createdAt desc`, then
 * `id asc`), with an optional assignment filter. The organization filter is
 * never optional (`DEC-061`); paging is applied after the ordering.
 */
export async function listShiftAdjustments(
  db: Database,
  query: ListShiftAdjustmentsQuery,
): Promise<readonly ShiftAdjustment[]> {
  const statement = db
    .select()
    .from(shiftAdjustment)
    .where(
      and(
        eq(shiftAdjustment.organizationId, query.organizationId),
        query.shiftAssignmentId === undefined
          ? undefined
          : eq(shiftAdjustment.shiftAssignmentId, query.shiftAssignmentId),
      ),
    )
    // Equal `created_at` → lowest id wins; the same rule the report subquery uses.
    .orderBy(desc(shiftAdjustment.createdAt), asc(shiftAdjustment.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

/** One approved assignment on an assigned/completed shift, joined to its shift and employee. */
export interface WorkedHoursAssignmentRow {
  readonly assignmentId: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly roleCode: string;
  /** Decimal string (`numeric(19,4)`, money — never a float). */
  readonly baseHourlyRate: string;
  readonly shiftId: string;
  readonly locationId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly breakMinutes: number;
  /** The latest correction's `adjusted_hours` (`numeric(9,2)`), or null. */
  readonly adjustedHours: string | null;
}

export interface ListWorkedHoursAssignmentsQuery {
  readonly organizationId: string;
  /** Inclusive lower bound on `shift.starts_at` (`>= from`). */
  readonly from: Date;
  /** Exclusive upper bound on `shift.starts_at` (`< to`). */
  readonly to: Date;
  readonly locationId?: string;
  readonly employeeId?: string;
}

/**
 * The approved assignments on assigned/completed shifts whose shift starts in
 * `[from, to)`, joined to their shift and employee (`WF-004`, `DEC-038`). The
 * `adjustedHours` field is the **latest** `shift_adjustment.adjusted_hours` for
 * the assignment (`created_at desc, id asc` — for equal `created_at` the lowest
 * id wins, matching `listShiftAdjustments`; null when there is none), resolved
 * with one correlated subquery so there is no N+1. The join is explicitly
 * organization-scoped on both sides (`DEC-061`) so the query stays org-safe even
 * without the `0052` guards. Order is `starts_at`, then assignment id.
 */
export async function listWorkedHoursAssignments(
  db: Database,
  query: ListWorkedHoursAssignmentsQuery,
): Promise<readonly WorkedHoursAssignmentRow[]> {
  const latestAdjustedHours = sql<string | null>`(
    select sa."adjusted_hours"::text
    from "shift_adjustment" sa
    where sa."shift_assignment_id" = ${shiftAssignment.id}
      and sa."organization_id" = ${shiftAssignment.organizationId}
    order by sa."created_at" desc, sa."id" asc
    limit 1
  )`;
  return db
    .select({
      assignmentId: shiftAssignment.id,
      employeeId: employee.id,
      employeeName: employee.name,
      roleCode: employee.roleCode,
      baseHourlyRate: employee.baseHourlyRate,
      shiftId: shift.id,
      locationId: shift.locationId,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      breakMinutes: shift.breakMinutes,
      adjustedHours: latestAdjustedHours,
    })
    .from(shiftAssignment)
    .innerJoin(shift, eq(shiftAssignment.shiftId, shift.id))
    .innerJoin(employee, eq(shiftAssignment.employeeId, employee.id))
    .where(
      and(
        eq(shiftAssignment.organizationId, query.organizationId),
        eq(shift.organizationId, query.organizationId),
        eq(employee.organizationId, query.organizationId),
        eq(shiftAssignment.state, "approved"),
        inArray(shift.state, ["assigned", "completed"]),
        gte(shift.startsAt, query.from),
        lt(shift.startsAt, query.to),
        query.locationId === undefined ? undefined : eq(shift.locationId, query.locationId),
        query.employeeId === undefined
          ? undefined
          : eq(shiftAssignment.employeeId, query.employeeId),
      ),
    )
    .orderBy(asc(shift.startsAt), asc(shiftAssignment.id));
}

export interface CreatePayrollReportInput {
  readonly organizationId: string;
  /** `date`, `YYYY-MM-DD`; the key of the `(organization_id, period_start)` unique. */
  readonly periodStart: string;
  /** `date`, `YYYY-MM-DD`; must be after `periodStart`. */
  readonly periodEnd: string;
  /** Plain uuid; the `app_user` FK is deferred. Nullable (unrecorded actor). */
  readonly generatedBy?: string | null;
  /** One of `PAYROLL_REPORT_STATUS`; the column default is `draft` when omitted. */
  readonly status?: string;
  /** The frozen, reproducible report lines (jsonb; stored verbatim). */
  readonly snapshot: unknown;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly createdBy?: string | null;
}

/**
 * Creates one monthly payroll-input report row (`WF-005`, `DEC-037`).
 * `organizationId` is supplied by the caller; `generated_at` takes the column
 * default `now()` and `status` the column default `draft` when omitted. The
 * `(organization_id, period_start)` unique means a regeneration must supersede
 * the prior same-period report first (the application's `generatePayrollReport`
 * does).
 */
export async function createPayrollReport(
  db: Database,
  input: CreatePayrollReportInput,
): Promise<PayrollReport> {
  const rows = await db
    .insert(payrollReport)
    .values({
      organizationId: input.organizationId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      ...(input.generatedBy === undefined ? {} : { generatedBy: input.generatedBy }),
      ...(input.status === undefined ? {} : { status: input.status }),
      snapshot: input.snapshot,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindPayrollReportQuery {
  readonly organizationId: string;
  readonly payrollReportId: string;
}

/** One payroll report by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findPayrollReport(
  db: Database,
  query: FindPayrollReportQuery,
): Promise<PayrollReport | undefined> {
  const rows = await db
    .select()
    .from(payrollReport)
    .where(
      and(
        eq(payrollReport.id, query.payrollReportId),
        eq(payrollReport.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface FindPayrollReportForPeriodQuery {
  readonly organizationId: string;
  /** `date`, `YYYY-MM-DD`; the period start that identifies the payroll month. */
  readonly periodStart: string;
}

/**
 * The **live** report for one `(organization, periodStart)` pair,
 * organization-scoped (`DEC-061`), or `undefined`. `(organization_id,
 * period_start)` is the partial unique supersede key (`DEC-104`) — the index
 * excludes `status = 'superseded'` — so this is the natural-key lookup the
 * generator uses to find the report it must supersede before inserting its
 * replacement. Superseded rows are retained under the same key, so the predicate
 * excludes them and returns the one live row (or `undefined`); without it a
 * later regeneration would read a retained superseded row, skip the supersede
 * and collide with the partial unique (23505).
 */
export async function findPayrollReportForPeriod(
  db: Database,
  query: FindPayrollReportForPeriodQuery,
): Promise<PayrollReport | undefined> {
  const rows = await db
    .select()
    .from(payrollReport)
    .where(
      and(
        eq(payrollReport.organizationId, query.organizationId),
        eq(payrollReport.periodStart, query.periodStart),
        ne(payrollReport.status, "superseded"),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * The same org-scoped, superseded-excluding select as
 * `findPayrollReportForPeriod`, but taking the row's write lock
 * (`SELECT … FOR UPDATE`) for the rest of the surrounding transaction. The
 * generator resolves the prior live report through this lock, so two concurrent
 * regenerations for one period serialise instead of both passing the existence
 * check and colliding on the partial unique `(organization_id, period_start)`
 * (23505). A period with no live report returns `undefined` without locking.
 */
export async function lockPayrollReportForPeriod(
  db: Database,
  query: FindPayrollReportForPeriodQuery,
): Promise<PayrollReport | undefined> {
  const rows = await db
    .select()
    .from(payrollReport)
    .where(
      and(
        eq(payrollReport.organizationId, query.organizationId),
        eq(payrollReport.periodStart, query.periodStart),
        ne(payrollReport.status, "superseded"),
      ),
    )
    .for("update")
    .limit(1);
  return rows[0];
}

export interface ListPayrollReportsQuery {
  readonly organizationId: string;
  /** One of `PAYROLL_REPORT_STATUS`, exact match. */
  readonly status?: string;
  /** Inclusive lower bound on `period_start` (`>= periodStartFrom`). */
  readonly periodStartFrom?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Payroll reports for one organization, newest period first (`period_start desc`,
 * then `id asc`), with optional status and period-start filters. The
 * organization filter is never optional (`DEC-061`); paging is applied after the
 * ordering.
 */
export async function listPayrollReports(
  db: Database,
  query: ListPayrollReportsQuery,
): Promise<readonly PayrollReport[]> {
  const statement = db
    .select()
    .from(payrollReport)
    .where(
      and(
        eq(payrollReport.organizationId, query.organizationId),
        query.status === undefined ? undefined : eq(payrollReport.status, query.status),
        query.periodStartFrom === undefined
          ? undefined
          : gte(payrollReport.periodStart, query.periodStartFrom),
      ),
    )
    .orderBy(desc(payrollReport.periodStart), asc(payrollReport.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface UpdatePayrollReportInput {
  readonly organizationId: string;
  readonly payrollReportId: string;
  /** One of `PAYROLL_REPORT_STATUS`; e.g. `superseded` or `exported`. */
  readonly status?: string;
  /** Replaces the frozen snapshot; an omitted field is untouched. */
  readonly snapshot?: unknown;
  /** Explicit `null` clears the export link; an omitted field is untouched. */
  readonly exportFileId?: string | null;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/**
 * Updates one payroll report's mutable fields, organization-scoped (`DEC-061`).
 * A field left out of the patch is untouched (drizzle skips `undefined`), while
 * an explicit value replaces it and an explicit `null` clears a nullable column;
 * the audit columns record the amendment. `periodStart`/`periodEnd` are immutable
 * after creation, and the id alone cannot address another tenant's row — a
 * missing or cross-organization id returns `undefined`, like `findPayrollReport`.
 */
export async function updatePayrollReport(
  db: Database,
  input: UpdatePayrollReportInput,
): Promise<PayrollReport | undefined> {
  const { organizationId, payrollReportId, actorId, ...patch } = input;
  const rows = await db
    .update(payrollReport)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(
      and(eq(payrollReport.id, payrollReportId), eq(payrollReport.organizationId, organizationId)),
    )
    .returning();
  return rows[0];
}
