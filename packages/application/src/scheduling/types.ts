import { PAYROLL_REPORT_STATUS, SHIFT_ASSIGNMENT_STATE, SHIFT_STATE } from "@aquarela/persistence";

import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for the shift-scheduling slice (`WF-002`,
 * `WF-003`, `DEC-037`, `DEC-038`).
 *
 * Both tables (`shift`, `shift_assignment`) carry `organization_id` directly,
 * so every read and write takes the organization and is scoped by it
 * (`DEC-061`). `timestamptz` columns cross the port as ISO strings and
 * `breakMinutes` as a number. The state vocabularies come from the persistence
 * `shift_state`/`shift_assignment_state` enums so there is one source of truth.
 *
 * This is a **different domain from the workforce personnel slice**, so it has
 * its own `SchedulingStore` port rather than extending `WorkforceStore`; the
 * only employee data it needs is the `primaryLocationId` the provisional
 * assignment rule matches against (`DEC-099` fail-closed precedent), plus the
 * `name`/`roleCode`/`baseHourlyRate` the worked-hours read projects.
 */

/** The `shift_state` vocabulary a shift may hold (`SHIFT_STATE`). */
export const SHIFT_STATES: readonly string[] = SHIFT_STATE;

/** The `shift_assignment_state` vocabulary an assignment may hold. */
export const SHIFT_ASSIGNMENT_STATES: readonly string[] = SHIFT_ASSIGNMENT_STATE;

/** The `payroll_report_status` vocabulary a report may hold. */
export const PAYROLL_REPORT_STATUSES: readonly string[] = PAYROLL_REPORT_STATUS;

/**
 * One `shift` row (`WF-002`, `DEC-037`). `roleCode` is the free-text role the
 * shift is planned for (the draft declares no CHECK, mirroring
 * `employee.role_code`); `state` follows the `shift_state` lifecycle
 * `open → published → assigned → …`. `actualStart`/`actualEnd` are reserved for
 * the later actual-time tracking (`DEC-038`) and stay null in the MVP.
 */
export interface ShiftRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly roleCode: string | null;
  /** `timestamptz`, ISO. */
  readonly startsAt: string;
  /** `timestamptz`, ISO; strictly after `startsAt`. */
  readonly endsAt: string;
  readonly breakMinutes: number;
  /** One of `SHIFT_STATE`. */
  readonly state: string;
  /** `timestamptz`, ISO, or null while the shift is not published. */
  readonly publishedAt: string | null;
  /** `timestamptz`, ISO; reserved for actual time tracking (`DEC-038`). */
  readonly actualStart: string | null;
  /** `timestamptz`, ISO; reserved for actual time tracking (`DEC-038`). */
  readonly actualEnd: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  /** `timestamptz`, ISO; null before any update. */
  readonly updatedAt: string | null;
}

export interface NewShiftRecord {
  readonly organizationId: string;
  readonly locationId: string;
  readonly roleCode: string | null;
  /** `timestamptz`, ISO. */
  readonly startsAt: string;
  /** `timestamptz`, ISO. */
  readonly endsAt: string;
  readonly breakMinutes: number;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/**
 * The mutable fields of a shift. `undefined` means "leave as is"; `null` clears
 * an optional field. `state` is not exposed to `updateShift` (the lifecycle is
 * owned by `publishShift`/`cancelShift`/`completeShift`); the lifecycle commands
 * and `assignShift` set it through this port.
 */
export interface UpdateShiftRecord {
  readonly organizationId: string;
  readonly shiftId: string;
  /** `timestamptz`, ISO. */
  readonly startsAt?: string;
  /** `timestamptz`, ISO. */
  readonly endsAt?: string;
  readonly breakMinutes?: number;
  readonly roleCode?: string | null;
  /** One of `SHIFT_STATE`; set only by the lifecycle commands. */
  readonly state?: string;
  /** `timestamptz`, ISO, or null; set when the shift is published. */
  readonly publishedAt?: string | null;
  /** The acting actor; recorded as `updated_by`. */
  readonly actorId?: string | null;
}

/** Shift filters for the store read. */
export interface ShiftListQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  /** One of `SHIFT_STATES`, exact match. */
  readonly state?: string;
  /** Inclusive lower bound on `starts_at`; an ISO instant. */
  readonly from?: string;
  /** Inclusive upper bound on `starts_at`; an ISO instant. */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * One `shift_assignment` row (`WF-003`): the fact that one employee is assigned
 * to one shift. The row carries its own actor and instant (`assignedBy`,
 * `assignedAt`) on top of the shared audit columns.
 */
export interface ShiftAssignmentRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly shiftId: string;
  readonly employeeId: string;
  /** One of `SHIFT_ASSIGNMENT_STATES`. */
  readonly state: string;
  readonly assignedBy: string | null;
  /** `timestamptz`, ISO. */
  readonly assignedAt: string;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  /** `timestamptz`, ISO; null before any update. */
  readonly updatedAt: string | null;
}

export interface NewShiftAssignmentRecord {
  readonly organizationId: string;
  readonly shiftId: string;
  readonly employeeId: string;
  /** One of `SHIFT_ASSIGNMENT_STATES`. */
  readonly state: string;
  readonly assignedBy: string | null;
  /** `timestamptz`, ISO. */
  readonly assignedAt: string;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/** The mutable fields of an assignment; only `state` and `assignedBy` move. */
export interface UpdateShiftAssignmentRecord {
  readonly organizationId: string;
  readonly shiftAssignmentId: string;
  /** One of `SHIFT_ASSIGNMENT_STATES`. */
  readonly state?: string;
  /**
   * The assigning actor on the row. A manager approval sets it to the deciding
   * actor (`WF-003`, `DEC-146`); omitted leaves it untouched.
   */
  readonly assignedBy?: string | null;
  /** The acting actor; recorded as `updated_by`. */
  readonly actorId?: string | null;
}

/** Assignment filters for the store read. */
export interface ShiftAssignmentListQuery {
  readonly organizationId: string;
  readonly shiftId?: string;
  readonly employeeId?: string;
  /** One of `SHIFT_ASSIGNMENT_STATES`, exact match. */
  readonly state?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * One `shift_adjustment` row (`WF-004`, `DEC-038`): a manual correction to one
 * assignment's derived worked hours. `adjustedHours` is a `numeric(9,2)` decimal
 * string; `approvedBy`/`approvedAt` are the manager-approval pair (both set or
 * both null).
 */
export interface ShiftAdjustmentRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly shiftAssignmentId: string;
  /** `numeric(9,2)` hours — a decimal string, never a float. */
  readonly adjustedHours: string;
  readonly reason: string;
  readonly approvedBy: string | null;
  /** `timestamptz`, ISO; null when unapproved. */
  readonly approvedAt: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
}

export interface NewShiftAdjustmentRecord {
  readonly organizationId: string;
  readonly shiftAssignmentId: string;
  /** `numeric(9,2)` hours — a decimal string, never a float. */
  readonly adjustedHours: string;
  readonly reason: string;
  readonly approvedBy: string | null;
  /** `timestamptz`, ISO, or null. */
  readonly approvedAt: string | null;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/** Adjustment filters for the store read. */
export interface ShiftAdjustmentListQuery {
  readonly organizationId: string;
  readonly shiftAssignmentId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * One approved assignment inside a worked-hours window: the assignment joined to
 * its shift and employee, with the latest correction's `adjustedHours` (or null).
 */
export interface WorkedHoursAssignmentRow {
  readonly assignmentId: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly roleCode: string;
  /** `numeric(19,4)` money — a decimal string, never a float. */
  readonly baseHourlyRate: string;
  readonly shiftId: string;
  readonly locationId: string;
  /** `timestamptz`, ISO. */
  readonly startsAt: string;
  /** `timestamptz`, ISO. */
  readonly endsAt: string;
  readonly breakMinutes: number;
  /** The latest correction's `numeric(9,2)` hours, or null. */
  readonly adjustedHours: string | null;
}

/** Worked-hours window filters for the store read (`from` inclusive, `to` exclusive). */
export interface WorkedHoursQuery {
  readonly organizationId: string;
  /** `timestamptz`, ISO. */
  readonly from: string;
  /** `timestamptz`, ISO. */
  readonly to: string;
  readonly locationId?: string;
  readonly employeeId?: string;
}

/**
 * One `payroll_report` row (`WF-005`, `DEC-037`): the monthly payroll-**input**
 * report. `snapshot` is the frozen, reproducible set of lines (kept as `unknown`
 * here — the `buildPayrollSnapshot` domain function owns its shape); `status`
 * follows the provisional `payroll_report_status` lifecycle. `exportFileId` is
 * the nullable real FK to `file_object` (`DEC-085`); the storage bytes / signed
 * URL stay deferred.
 */
export interface PayrollReportRecord {
  readonly id: string;
  readonly organizationId: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodStart: string;
  /** `date`, `YYYY-MM-DD`; after `periodStart`. */
  readonly periodEnd: string;
  /** `timestamptz`, ISO. */
  readonly generatedAt: string;
  readonly generatedBy: string | null;
  /** One of `PAYROLL_REPORT_STATUSES`. */
  readonly status: string;
  readonly snapshot: unknown;
  readonly exportFileId: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  /** `timestamptz`, ISO; null before any update. */
  readonly updatedAt: string | null;
}

export interface NewPayrollReportRecord {
  readonly organizationId: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodStart: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodEnd: string;
  readonly generatedBy: string | null;
  /** One of `PAYROLL_REPORT_STATUSES`. */
  readonly status: string;
  readonly snapshot: unknown;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/** The mutable fields of a payroll report. */
export interface UpdatePayrollReportRecord {
  readonly organizationId: string;
  readonly payrollReportId: string;
  /** One of `PAYROLL_REPORT_STATUSES`. */
  readonly status?: string;
  /** Replaces the frozen snapshot; an omitted field is untouched. */
  readonly snapshot?: unknown;
  /** Explicit `null` clears the export link; an omitted field is untouched. */
  readonly exportFileId?: string | null;
  /** The acting actor; recorded as `updated_by`. */
  readonly actorId?: string | null;
}

/** Payroll-report filters for the store read. */
export interface PayrollReportListQuery {
  readonly organizationId: string;
  /** One of `PAYROLL_REPORT_STATUSES`, exact match. */
  readonly status?: string;
  /** Inclusive lower bound on `period_start`; `YYYY-MM-DD`. */
  readonly periodStartFrom?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The only `employee` fields the scheduling slice reads: the `primaryLocationId`
 * the provisional same-location assignment rule matches against and the
 * `roleCode` the `WF-003` role-match rule compares with the shift's role.
 */
export interface SchedulingEmployeeRecord {
  readonly id: string;
  readonly organizationId: string;
  /** Optional `app_user` login link (`WF-001`, `DEC-146`); may be null. */
  readonly userId: string | null;
  readonly primaryLocationId: string | null;
  readonly roleCode: string;
  readonly name: string;
  /** `numeric(19,4)` money — a decimal string, never a float. */
  readonly baseHourlyRate: string;
}

/**
 * One of an employee's own assignments joined to its shift (`WF-003`,
 * `DEC-146`): the "My shifts" read. `timestamptz` columns cross the port as ISO
 * strings; `assignmentState` is one of `SHIFT_ASSIGNMENT_STATES` and
 * `shiftState` one of `SHIFT_STATES`.
 */
export interface MyShiftRow {
  readonly assignmentId: string;
  /** One of `SHIFT_ASSIGNMENT_STATES`. */
  readonly assignmentState: string;
  /** `timestamptz`, ISO. */
  readonly assignedAt: string;
  readonly shiftId: string;
  readonly locationId: string;
  readonly roleCode: string | null;
  /** `timestamptz`, ISO. */
  readonly startsAt: string;
  /** `timestamptz`, ISO. */
  readonly endsAt: string;
  readonly breakMinutes: number;
  /** One of `SHIFT_STATES`. */
  readonly shiftState: string;
}

/**
 * One self-originated `pending_approval` assignment joined to its shift and
 * employee (`WF-003`, `DEC-146`): the manager review queue row.
 */
export interface PendingSelfAssignmentRow {
  readonly assignmentId: string;
  /** `timestamptz`, ISO. */
  readonly assignedAt: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly shiftId: string;
  readonly locationId: string;
  readonly roleCode: string | null;
  /** `timestamptz`, ISO. */
  readonly startsAt: string;
  /** `timestamptz`, ISO. */
  readonly endsAt: string;
  readonly breakMinutes: number;
}

/**
 * The persistence port for the shift-scheduling slice: the `shift` entity plus
 * its assignments. One port covers both tables, mirroring the persistence
 * repository module. `findEmployee` is the employee lookup `assignShift` needs
 * to apply the provisional location rule; it returns only the matched fields.
 */
export interface SchedulingStore {
  /**
   * Binds `fn` to one transaction so a write and its audit fact commit or roll
   * back together.
   */
  withTransaction<T>(fn: (store: SchedulingStore) => Promise<T>): Promise<T>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
  createShift(input: NewShiftRecord): Promise<ShiftRecord>;
  /** One shift by id, organization-scoped (`DEC-061`), or `undefined`. */
  findShift(query: {
    readonly organizationId: string;
    readonly shiftId: string;
  }): Promise<ShiftRecord | undefined>;
  /**
   * One shift by id, organization-scoped (`DEC-061`), or `undefined`, taking the
   * row's write lock (`SELECT … FOR UPDATE`) for the rest of the surrounding
   * transaction. The lifecycle commands lock the shift before deriving the next
   * state so concurrent transitions serialise.
   */
  lockShift(query: {
    readonly organizationId: string;
    readonly shiftId: string;
  }): Promise<ShiftRecord | undefined>;
  /**
   * Applies a patch to one shift, organization-scoped (`DEC-061`); `undefined`
   * when no row matches in the organization.
   */
  updateShift(input: UpdateShiftRecord): Promise<ShiftRecord | undefined>;
  listShifts(query: ShiftListQuery): Promise<readonly ShiftRecord[]>;
  createShiftAssignment(input: NewShiftAssignmentRecord): Promise<ShiftAssignmentRecord>;
  /** One assignment by id, organization-scoped (`DEC-061`), or `undefined`. */
  findShiftAssignment(query: {
    readonly organizationId: string;
    readonly shiftAssignmentId: string;
  }): Promise<ShiftAssignmentRecord | undefined>;
  /**
   * The assignment for one `(shift, employee)` pair, organization-scoped
   * (`DEC-061`), or `undefined`.
   */
  findShiftAssignmentByShiftEmployee(query: {
    readonly organizationId: string;
    readonly shiftId: string;
    readonly employeeId: string;
  }): Promise<ShiftAssignmentRecord | undefined>;
  /**
   * Applies a patch to one assignment, organization-scoped (`DEC-061`);
   * `undefined` when no row matches in the organization.
   */
  updateShiftAssignment(
    input: UpdateShiftAssignmentRecord,
  ): Promise<ShiftAssignmentRecord | undefined>;
  listShiftAssignments(query: ShiftAssignmentListQuery): Promise<readonly ShiftAssignmentRecord[]>;
  /** Creates one worked-hours correction (`WF-004`, `DEC-038`). */
  createShiftAdjustment(input: NewShiftAdjustmentRecord): Promise<ShiftAdjustmentRecord>;
  /** One adjustment by id, organization-scoped (`DEC-061`), or `undefined`. */
  findShiftAdjustment(query: {
    readonly organizationId: string;
    readonly shiftAdjustmentId: string;
  }): Promise<ShiftAdjustmentRecord | undefined>;
  listShiftAdjustments(query: ShiftAdjustmentListQuery): Promise<readonly ShiftAdjustmentRecord[]>;
  /**
   * Approved assignments on assigned/completed shifts whose shift starts in the
   * window, joined to their shift and employee, with the latest correction.
   */
  listWorkedHoursAssignments(query: WorkedHoursQuery): Promise<readonly WorkedHoursAssignmentRow[]>;
  /** Creates one monthly payroll-input report (`WF-005`, `DEC-037`). */
  createPayrollReport(input: NewPayrollReportRecord): Promise<PayrollReportRecord>;
  /** One report by id, organization-scoped (`DEC-061`), or `undefined`. */
  findPayrollReport(query: {
    readonly organizationId: string;
    readonly payrollReportId: string;
  }): Promise<PayrollReportRecord | undefined>;
  /**
   * The **live** report for one `(organization, periodStart)` pair,
   * organization-scoped (`DEC-061`), or `undefined` — the partial unique
   * supersede-key lookup. Retained `superseded` rows are excluded, so a
   * regenerated period still returns exactly one (live) row.
   */
  findPayrollReportForPeriod(query: {
    readonly organizationId: string;
    readonly periodStart: string;
  }): Promise<PayrollReportRecord | undefined>;
  /**
   * The same live-report lookup as `findPayrollReportForPeriod`, taking the
   * row's write lock (`SELECT … FOR UPDATE`) for the rest of the surrounding
   * transaction, so concurrent regenerations for one period serialise. Used by
   * `generatePayrollReport` to resolve the prior report it must supersede.
   */
  lockPayrollReportForPeriod(query: {
    readonly organizationId: string;
    readonly periodStart: string;
  }): Promise<PayrollReportRecord | undefined>;
  listPayrollReports(query: PayrollReportListQuery): Promise<readonly PayrollReportRecord[]>;
  /**
   * Applies a patch to one report, organization-scoped (`DEC-061`); `undefined`
   * when no row matches in the organization.
   */
  updatePayrollReport(input: UpdatePayrollReportRecord): Promise<PayrollReportRecord | undefined>;
  /**
   * One employee by id, organization-scoped (`DEC-061`), or `undefined`,
   * projected to the fields the assignment rule needs.
   */
  findEmployee(query: {
    readonly organizationId: string;
    readonly employeeId: string;
  }): Promise<SchedulingEmployeeRecord | undefined>;
  /**
   * Every employee row linked to one `app_user` id, organization-scoped
   * (`DEC-061`), ordered by id. `employee.user_id` has no unique constraint, so
   * this is a list; the caller fails closed on zero or more than one row
   * (`DEC-146`).
   */
  findEmployeesByUserId(query: {
    readonly organizationId: string;
    readonly userId: string;
  }): Promise<readonly SchedulingEmployeeRecord[]>;
  /**
   * Takes the employee row's write lock (`SELECT … FOR UPDATE`) for the rest of
   * the surrounding transaction. `selfAssignShift` acquires it after the shift
   * lock and before counting the weekly self-assignments, so two concurrent
   * self-assigns by one employee serialise on the employee row: the second
   * transaction counts the first's just-inserted row and the weekly limit
   * holds (`WF-003`, `DEC-146`). A missing id locks nothing.
   */
  lockEmployeeForSelfAssignment(employeeId: string): Promise<void>;
  /**
   * How many of the employee's self-originated (`assigned_by is null`)
   * assignments in a live state overlap the half-open week
   * `[weekStart, weekEnd)` — the weekly self-assignment maximum's counter.
   */
  countSelfAssignedShiftsInWeek(query: {
    readonly organizationId: string;
    readonly employeeId: string;
    /** `timestamptz`, ISO. */
    readonly weekStart: string;
    /** `timestamptz`, ISO. */
    readonly weekEnd: string;
  }): Promise<number>;
  /** One employee's own assignments joined to their shifts (`DEC-146`). */
  listMyShifts(query: {
    readonly organizationId: string;
    readonly employeeId: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly MyShiftRow[]>;
  /** The manager review queue of self-originated pending assignments. */
  listPendingSelfAssignments(query: {
    readonly organizationId: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly PendingSelfAssignmentRow[]>;
}
