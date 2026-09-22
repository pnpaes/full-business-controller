import { WORKED_HOURS_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";

import type { AuditInput } from "../auth";

import { DEFAULT_SHIFT_ADJUSTMENT_LIMIT } from "./list-shift-adjustments";
import { DEFAULT_SHIFT_ASSIGNMENT_LIMIT } from "./list-shift-assignments";
import { DEFAULT_SHIFT_LIMIT } from "./list-shifts";
import { DEFAULT_PAYROLL_REPORT_LIMIT } from "./list-payroll-reports";
import type {
  NewPayrollReportRecord,
  NewShiftAdjustmentRecord,
  NewShiftAssignmentRecord,
  NewShiftRecord,
  PayrollReportListQuery,
  PayrollReportRecord,
  SchedulingEmployeeRecord,
  SchedulingStore,
  ShiftAdjustmentListQuery,
  ShiftAdjustmentRecord,
  ShiftAssignmentListQuery,
  ShiftAssignmentRecord,
  ShiftListQuery,
  ShiftRecord,
  UpdatePayrollReportRecord,
  UpdateShiftAssignmentRecord,
  UpdateShiftRecord,
  WorkedHoursAssignmentRow,
  WorkedHoursQuery,
} from "./types";

/**
 * A shallow copy of every mutable map/array a scheduling transaction can touch,
 * used to roll back a failed `withTransaction` (the fake runs inline without one).
 */
interface SchedulingSnapshot {
  readonly shifts: Map<string, ShiftRecord>;
  readonly shiftAssignments: Map<string, ShiftAssignmentRecord>;
  readonly shiftAdjustments: Map<string, ShiftAdjustmentRecord>;
  readonly payrollReports: Map<string, PayrollReportRecord>;
  readonly audits: AuditInput[];
}

/**
 * In-memory `SchedulingStore` for the unit suite. It mirrors the Postgres
 * adapter's organization scoping, ordering (`starts_at`/`assigned_at`, then id)
 * and paging so the commands and queries can be exercised without a database;
 * `scheduling.postgres.test.ts` covers the real adapter.
 */
export class FakeSchedulingStore implements SchedulingStore {
  readonly shifts = new Map<string, ShiftRecord>();
  readonly shiftAssignments = new Map<string, ShiftAssignmentRecord>();
  readonly shiftAdjustments = new Map<string, ShiftAdjustmentRecord>();
  readonly payrollReports = new Map<string, PayrollReportRecord>();
  readonly employees = new Map<string, SchedulingEmployeeRecord>();
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async withTransaction<T>(fn: (store: SchedulingStore) => Promise<T>): Promise<T> {
    // Snapshot then run so a failure mid-transaction rolls back every write
    // (a command and its audit fact commit or roll back together, like the
    // Postgres adapter).
    const snapshot = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  private snapshot(): SchedulingSnapshot {
    return {
      shifts: new Map(this.shifts),
      shiftAssignments: new Map(this.shiftAssignments),
      shiftAdjustments: new Map(this.shiftAdjustments),
      payrollReports: new Map(this.payrollReports),
      audits: [...this.audits],
    };
  }

  private restore(snapshot: SchedulingSnapshot): void {
    this.shifts.clear();
    for (const [key, value] of snapshot.shifts) this.shifts.set(key, value);
    this.shiftAssignments.clear();
    for (const [key, value] of snapshot.shiftAssignments) this.shiftAssignments.set(key, value);
    this.shiftAdjustments.clear();
    for (const [key, value] of snapshot.shiftAdjustments) this.shiftAdjustments.set(key, value);
    this.payrollReports.clear();
    for (const [key, value] of snapshot.payrollReports) this.payrollReports.set(key, value);
    this.audits.length = 0;
    this.audits.push(...snapshot.audits);
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
  }

  async createShift(input: NewShiftRecord): Promise<ShiftRecord> {
    const record: ShiftRecord = {
      id: this.nextId("shift"),
      organizationId: input.organizationId,
      locationId: input.locationId,
      roleCode: input.roleCode,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      breakMinutes: input.breakMinutes,
      // A new shift starts `open`; publishing/cancelling/completing are commands.
      state: "open",
      publishedAt: null,
      actualStart: null,
      actualEnd: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    this.shifts.set(record.id, record);
    return record;
  }

  async findShift(query: {
    readonly organizationId: string;
    readonly shiftId: string;
  }): Promise<ShiftRecord | undefined> {
    const shift = this.shifts.get(query.shiftId);
    return shift !== undefined && shift.organizationId === query.organizationId ? shift : undefined;
  }

  /** The fake has no row locks, so locking is the same organization-scoped read. */
  async lockShift(query: {
    readonly organizationId: string;
    readonly shiftId: string;
  }): Promise<ShiftRecord | undefined> {
    return this.findShift(query);
  }

  async updateShift(input: UpdateShiftRecord): Promise<ShiftRecord | undefined> {
    const existing = await this.findShift({
      organizationId: input.organizationId,
      shiftId: input.shiftId,
    });
    if (existing === undefined) return undefined;
    // Replace the record rather than mutate it: the transaction snapshot keeps
    // the old object reference, so an in-place edit would survive a rollback.
    const record: ShiftRecord = {
      ...existing,
      ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
      ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
      ...(input.breakMinutes === undefined ? {} : { breakMinutes: input.breakMinutes }),
      ...(input.roleCode === undefined ? {} : { roleCode: input.roleCode }),
      ...(input.state === undefined ? {} : { state: input.state }),
      ...(input.publishedAt === undefined ? {} : { publishedAt: input.publishedAt }),
      updatedAt: new Date().toISOString(),
    };
    this.shifts.set(record.id, record);
    return record;
  }

  async listShifts(query: ShiftListQuery): Promise<readonly ShiftRecord[]> {
    const rows = [...this.shifts.values()]
      .filter((shift) => shift.organizationId === query.organizationId)
      .filter((shift) => query.locationId === undefined || shift.locationId === query.locationId)
      .filter((shift) => query.state === undefined || shift.state === query.state)
      .filter(
        (shift) => query.from === undefined || Date.parse(shift.startsAt) >= Date.parse(query.from),
      )
      .filter(
        (shift) => query.to === undefined || Date.parse(shift.startsAt) <= Date.parse(query.to),
      )
      .sort((a, b) => {
        if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
    const offset = query.offset ?? 0;
    // Default to the application page cap, mirroring the Postgres adapter and
    // the commands: an omitted `limit` must never hand back the whole rota.
    const limit = query.limit ?? DEFAULT_SHIFT_LIMIT;
    return rows.slice(offset, offset + limit);
  }

  async createShiftAssignment(input: NewShiftAssignmentRecord): Promise<ShiftAssignmentRecord> {
    const record: ShiftAssignmentRecord = {
      id: this.nextId("shift-assignment"),
      organizationId: input.organizationId,
      shiftId: input.shiftId,
      employeeId: input.employeeId,
      state: input.state,
      assignedBy: input.assignedBy,
      assignedAt: input.assignedAt,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    this.shiftAssignments.set(record.id, record);
    return record;
  }

  async findShiftAssignment(query: {
    readonly organizationId: string;
    readonly shiftAssignmentId: string;
  }): Promise<ShiftAssignmentRecord | undefined> {
    const assignment = this.shiftAssignments.get(query.shiftAssignmentId);
    return assignment !== undefined && assignment.organizationId === query.organizationId
      ? assignment
      : undefined;
  }

  async findShiftAssignmentByShiftEmployee(query: {
    readonly organizationId: string;
    readonly shiftId: string;
    readonly employeeId: string;
  }): Promise<ShiftAssignmentRecord | undefined> {
    return [...this.shiftAssignments.values()].find(
      (assignment) =>
        assignment.organizationId === query.organizationId &&
        assignment.shiftId === query.shiftId &&
        assignment.employeeId === query.employeeId,
    );
  }

  async updateShiftAssignment(
    input: UpdateShiftAssignmentRecord,
  ): Promise<ShiftAssignmentRecord | undefined> {
    const existing = await this.findShiftAssignment({
      organizationId: input.organizationId,
      shiftAssignmentId: input.shiftAssignmentId,
    });
    if (existing === undefined) return undefined;
    // Replace the record rather than mutate it (see `updateShift`).
    const record: ShiftAssignmentRecord = {
      ...existing,
      ...(input.state === undefined ? {} : { state: input.state }),
      updatedAt: new Date().toISOString(),
    };
    this.shiftAssignments.set(record.id, record);
    return record;
  }

  async listShiftAssignments(
    query: ShiftAssignmentListQuery,
  ): Promise<readonly ShiftAssignmentRecord[]> {
    const rows = [...this.shiftAssignments.values()]
      .filter((assignment) => assignment.organizationId === query.organizationId)
      .filter((assignment) => query.shiftId === undefined || assignment.shiftId === query.shiftId)
      .filter(
        (assignment) =>
          query.employeeId === undefined || assignment.employeeId === query.employeeId,
      )
      .filter((assignment) => query.state === undefined || assignment.state === query.state)
      .sort((a, b) => {
        if (a.assignedAt !== b.assignedAt) return a.assignedAt < b.assignedAt ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
    const offset = query.offset ?? 0;
    // Mirror the assignment command's page cap: an omitted `limit` is bounded.
    const limit = query.limit ?? DEFAULT_SHIFT_ASSIGNMENT_LIMIT;
    return rows.slice(offset, offset + limit);
  }

  async createShiftAdjustment(input: NewShiftAdjustmentRecord): Promise<ShiftAdjustmentRecord> {
    const record: ShiftAdjustmentRecord = {
      id: this.nextId("shift-adjustment"),
      organizationId: input.organizationId,
      shiftAssignmentId: input.shiftAssignmentId,
      // Mirror the `numeric(9,2)` column: normalise to two decimal places.
      adjustedHours: formatDecimal(
        parseDecimal(input.adjustedHours, WORKED_HOURS_SCALE),
        WORKED_HOURS_SCALE,
      ),
      reason: input.reason,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt,
      createdAt: new Date().toISOString(),
    };
    this.shiftAdjustments.set(record.id, record);
    return record;
  }

  async findShiftAdjustment(query: {
    readonly organizationId: string;
    readonly shiftAdjustmentId: string;
  }): Promise<ShiftAdjustmentRecord | undefined> {
    const adjustment = this.shiftAdjustments.get(query.shiftAdjustmentId);
    return adjustment !== undefined && adjustment.organizationId === query.organizationId
      ? adjustment
      : undefined;
  }

  async listShiftAdjustments(
    query: ShiftAdjustmentListQuery,
  ): Promise<readonly ShiftAdjustmentRecord[]> {
    const rows = [...this.shiftAdjustments.values()]
      .filter((adjustment) => adjustment.organizationId === query.organizationId)
      .filter(
        (adjustment) =>
          query.shiftAssignmentId === undefined ||
          adjustment.shiftAssignmentId === query.shiftAssignmentId,
      )
      .sort((a, b) => {
        // Persistence order: `created_at desc, id asc`.
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
        if (a.id !== b.id) return a.id < b.id ? -1 : 1;
        return 0;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? DEFAULT_SHIFT_ADJUSTMENT_LIMIT;
    return rows.slice(offset, offset + limit);
  }

  /**
   * The latest correction for one assignment (`created_at desc, id desc`),
   * mirroring the persistence correlated subquery; null when there is none.
   */
  private latestAdjustedHours(shiftAssignmentId: string): string | null {
    const latest = [...this.shiftAdjustments.values()]
      .filter((row) => row.shiftAssignmentId === shiftAssignmentId)
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
        if (a.id !== b.id) return a.id < b.id ? 1 : -1;
        return 0;
      })[0];
    return latest === undefined ? null : latest.adjustedHours;
  }

  async listWorkedHoursAssignments(
    query: WorkedHoursQuery,
  ): Promise<readonly WorkedHoursAssignmentRow[]> {
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    const rows: WorkedHoursAssignmentRow[] = [];
    for (const assignment of this.shiftAssignments.values()) {
      if (assignment.organizationId !== query.organizationId) continue;
      if (assignment.state !== "approved") continue;
      const shift = this.shifts.get(assignment.shiftId);
      if (shift === undefined || shift.organizationId !== query.organizationId) continue;
      if (shift.state !== "assigned" && shift.state !== "completed") continue;
      const startsAt = Date.parse(shift.startsAt);
      if (startsAt < from || startsAt >= to) continue;
      if (query.locationId !== undefined && shift.locationId !== query.locationId) continue;
      if (query.employeeId !== undefined && assignment.employeeId !== query.employeeId) continue;
      const person = this.employees.get(assignment.employeeId);
      if (person === undefined) continue;
      rows.push({
        assignmentId: assignment.id,
        employeeId: person.id,
        employeeName: person.name,
        roleCode: person.roleCode,
        baseHourlyRate: person.baseHourlyRate,
        shiftId: shift.id,
        locationId: shift.locationId,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        breakMinutes: shift.breakMinutes,
        adjustedHours: this.latestAdjustedHours(assignment.id),
      });
    }
    return rows.sort((a, b) => {
      if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1;
      if (a.assignmentId !== b.assignmentId) return a.assignmentId < b.assignmentId ? -1 : 1;
      return 0;
    });
  }

  async createPayrollReport(input: NewPayrollReportRecord): Promise<PayrollReportRecord> {
    const record: PayrollReportRecord = {
      id: this.nextId("payroll-report"),
      organizationId: input.organizationId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      generatedAt: new Date().toISOString(),
      generatedBy: input.generatedBy,
      status: input.status,
      snapshot: input.snapshot,
      exportFileId: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    this.payrollReports.set(record.id, record);
    return record;
  }

  async findPayrollReport(query: {
    readonly organizationId: string;
    readonly payrollReportId: string;
  }): Promise<PayrollReportRecord | undefined> {
    const report = this.payrollReports.get(query.payrollReportId);
    return report !== undefined && report.organizationId === query.organizationId
      ? report
      : undefined;
  }

  async findPayrollReportForPeriod(query: {
    readonly organizationId: string;
    readonly periodStart: string;
  }): Promise<PayrollReportRecord | undefined> {
    return [...this.payrollReports.values()].find(
      (report) =>
        report.organizationId === query.organizationId && report.periodStart === query.periodStart,
    );
  }

  async listPayrollReports(query: PayrollReportListQuery): Promise<readonly PayrollReportRecord[]> {
    const rows = [...this.payrollReports.values()]
      .filter((report) => report.organizationId === query.organizationId)
      .filter((report) => query.status === undefined || report.status === query.status)
      .filter(
        (report) =>
          query.periodStartFrom === undefined || report.periodStart >= query.periodStartFrom,
      )
      .sort((a, b) => {
        // Persistence order: `period_start desc, id asc`.
        if (a.periodStart !== b.periodStart) return a.periodStart < b.periodStart ? 1 : -1;
        return a.id < b.id ? -1 : 1;
      });
    const offset = query.offset ?? 0;
    // Mirror the Postgres adapter and the commands: an omitted `limit` is bounded.
    const limit = query.limit ?? DEFAULT_PAYROLL_REPORT_LIMIT;
    return rows.slice(offset, offset + limit);
  }

  async updatePayrollReport(
    input: UpdatePayrollReportRecord,
  ): Promise<PayrollReportRecord | undefined> {
    const existing = await this.findPayrollReport({
      organizationId: input.organizationId,
      payrollReportId: input.payrollReportId,
    });
    if (existing === undefined) return undefined;
    // Replace the record rather than mutate it (see `updateShift`).
    const record: PayrollReportRecord = {
      ...existing,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.snapshot === undefined ? {} : { snapshot: input.snapshot }),
      ...(input.exportFileId === undefined ? {} : { exportFileId: input.exportFileId }),
      updatedAt: new Date().toISOString(),
    };
    this.payrollReports.set(record.id, record);
    return record;
  }

  async findEmployee(query: {
    readonly organizationId: string;
    readonly employeeId: string;
  }): Promise<SchedulingEmployeeRecord | undefined> {
    const employee = this.employees.get(query.employeeId);
    return employee !== undefined && employee.organizationId === query.organizationId
      ? employee
      : undefined;
  }
}

export interface SchedulingFixture {
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  readonly otherLocationId: string;
  readonly employeeId: string;
  readonly otherEmployeeId: string;
}

/**
 * Seeds the two-organization fixture the scheduling tests share: a location id
 * in each organization so a shift can be planned in one and read from the
 * other, plus the ids of one employee per organization for the assignment rule.
 */
export function seedSchedulingFixture(): SchedulingFixture {
  return {
    organizationId: "org-1",
    otherOrganizationId: "org-2",
    actorId: "actor-1",
    locationId: "loc-1",
    otherLocationId: "loc-2",
    employeeId: "employee-1",
    otherEmployeeId: "employee-2",
  };
}

/**
 * Registers one employee in the fake store's lookup with the primary location
 * and role the assignment rules match against (`WF-003`), plus the
 * `name`/`baseHourlyRate` the worked-hours read projects (defaulted so the
 * assignment-rule tests need not supply them).
 */
export function seedSchedulingEmployee(
  store: FakeSchedulingStore,
  employee: {
    readonly id: string;
    readonly organizationId: string;
    readonly primaryLocationId: string | null;
    readonly roleCode: string;
    readonly name?: string;
    readonly baseHourlyRate?: string;
  },
): void {
  store.employees.set(employee.id, {
    id: employee.id,
    organizationId: employee.organizationId,
    primaryLocationId: employee.primaryLocationId,
    roleCode: employee.roleCode,
    name: employee.name ?? employee.id,
    baseHourlyRate: employee.baseHourlyRate ?? "0.0000",
  });
}
