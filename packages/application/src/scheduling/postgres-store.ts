import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

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

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/** `timestamptz`, ISO, or `null` — the adapter's read-side convention. */
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** The write-side twin of `toIso`: an ISO string or `null` becomes a `Date` or `null`. */
function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toShift(row: repo.Shift): ShiftRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    roleCode: row.roleCode,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    breakMinutes: row.breakMinutes,
    state: row.state,
    publishedAt: toIso(row.publishedAt),
    actualStart: toIso(row.actualStart),
    actualEnd: toIso(row.actualEnd),
    createdAt: row.createdAt.toISOString(),
    updatedAt: toIso(row.updatedAt),
  };
}

function toShiftAssignment(row: repo.ShiftAssignment): ShiftAssignmentRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    shiftId: row.shiftId,
    employeeId: row.employeeId,
    state: row.state,
    assignedBy: row.assignedBy,
    assignedAt: row.assignedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: toIso(row.updatedAt),
  };
}

function toShiftAdjustment(row: repo.ShiftAdjustment): ShiftAdjustmentRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    shiftAssignmentId: row.shiftAssignmentId,
    adjustedHours: row.adjustedHours,
    reason: row.reason,
    approvedBy: row.approvedBy,
    approvedAt: toIso(row.approvedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

function toPayrollReport(row: repo.PayrollReport): PayrollReportRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    generatedAt: row.generatedAt.toISOString(),
    generatedBy: row.generatedBy,
    status: row.status,
    snapshot: row.snapshot,
    exportFileId: row.exportFileId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * Adapts the persistence scheduling repository to the `SchedulingStore` port:
 * the `timestamptz` columns become ISO strings on read and `Date`s on write, and
 * every read/write passes the organization through so the adapter cannot escape
 * the `DEC-061` row scope. `findEmployee` is projected to the fields the
 * assignment rules read (`primaryLocationId`, `roleCode`).
 */
export function createPostgresSchedulingStore(db: Database): SchedulingStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresSchedulingStore(db));
      }
      return db.transaction((tx) => fn(createPostgresSchedulingStore(tx)));
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
    createShift: async (input: NewShiftRecord) =>
      toShift(
        await repo.createShift(db, {
          organizationId: input.organizationId,
          locationId: input.locationId,
          roleCode: input.roleCode,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          breakMinutes: input.breakMinutes,
          createdBy: input.createdBy,
        }),
      ),
    findShift: async (query) => {
      const row = await repo.findShift(db, {
        organizationId: query.organizationId,
        shiftId: query.shiftId,
      });
      return row === undefined ? undefined : toShift(row);
    },
    lockShift: async (query) => {
      const row = await repo.lockShift(db, {
        organizationId: query.organizationId,
        shiftId: query.shiftId,
      });
      return row === undefined ? undefined : toShift(row);
    },
    updateShift: async (input: UpdateShiftRecord) => {
      const row = await repo.updateShift(db, {
        organizationId: input.organizationId,
        shiftId: input.shiftId,
        ...(input.startsAt === undefined ? {} : { startsAt: new Date(input.startsAt) }),
        ...(input.endsAt === undefined ? {} : { endsAt: new Date(input.endsAt) }),
        ...(input.breakMinutes === undefined ? {} : { breakMinutes: input.breakMinutes }),
        ...(input.roleCode === undefined ? {} : { roleCode: input.roleCode }),
        ...(input.state === undefined ? {} : { state: input.state }),
        ...(input.publishedAt === undefined ? {} : { publishedAt: toDate(input.publishedAt) }),
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      });
      return row === undefined ? undefined : toShift(row);
    },
    listShifts: async (query: ShiftListQuery) => {
      const rows = await repo.listShifts(db, {
        organizationId: query.organizationId,
        ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.from === undefined ? {} : { from: new Date(query.from) }),
        ...(query.to === undefined ? {} : { to: new Date(query.to) }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toShift);
    },
    createShiftAssignment: async (input: NewShiftAssignmentRecord) =>
      toShiftAssignment(
        await repo.createShiftAssignment(db, {
          organizationId: input.organizationId,
          shiftId: input.shiftId,
          employeeId: input.employeeId,
          state: input.state,
          assignedBy: input.assignedBy,
          assignedAt: new Date(input.assignedAt),
          createdBy: input.createdBy,
        }),
      ),
    findShiftAssignment: async (query) => {
      const row = await repo.findShiftAssignment(db, {
        organizationId: query.organizationId,
        shiftAssignmentId: query.shiftAssignmentId,
      });
      return row === undefined ? undefined : toShiftAssignment(row);
    },
    findShiftAssignmentByShiftEmployee: async (query) => {
      const row = await repo.findShiftAssignmentByShiftEmployee(db, {
        organizationId: query.organizationId,
        shiftId: query.shiftId,
        employeeId: query.employeeId,
      });
      return row === undefined ? undefined : toShiftAssignment(row);
    },
    updateShiftAssignment: async (input: UpdateShiftAssignmentRecord) => {
      const row = await repo.updateShiftAssignment(db, {
        organizationId: input.organizationId,
        shiftAssignmentId: input.shiftAssignmentId,
        ...(input.state === undefined ? {} : { state: input.state }),
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      });
      return row === undefined ? undefined : toShiftAssignment(row);
    },
    listShiftAssignments: async (query: ShiftAssignmentListQuery) => {
      const rows = await repo.listShiftAssignments(db, {
        organizationId: query.organizationId,
        ...(query.shiftId === undefined ? {} : { shiftId: query.shiftId }),
        ...(query.employeeId === undefined ? {} : { employeeId: query.employeeId }),
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toShiftAssignment);
    },
    createShiftAdjustment: async (input: NewShiftAdjustmentRecord) =>
      toShiftAdjustment(
        await repo.createShiftAdjustment(db, {
          organizationId: input.organizationId,
          shiftAssignmentId: input.shiftAssignmentId,
          adjustedHours: input.adjustedHours,
          reason: input.reason,
          approvedBy: input.approvedBy,
          approvedAt: toDate(input.approvedAt),
          createdBy: input.createdBy,
        }),
      ),
    findShiftAdjustment: async (query) => {
      const row = await repo.findShiftAdjustment(db, {
        organizationId: query.organizationId,
        shiftAdjustmentId: query.shiftAdjustmentId,
      });
      return row === undefined ? undefined : toShiftAdjustment(row);
    },
    listShiftAdjustments: async (query: ShiftAdjustmentListQuery) => {
      const rows = await repo.listShiftAdjustments(db, {
        organizationId: query.organizationId,
        ...(query.shiftAssignmentId === undefined
          ? {}
          : { shiftAssignmentId: query.shiftAssignmentId }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toShiftAdjustment);
    },
    listWorkedHoursAssignments: async (
      query: WorkedHoursQuery,
    ): Promise<readonly WorkedHoursAssignmentRow[]> => {
      const rows = await repo.listWorkedHoursAssignments(db, {
        organizationId: query.organizationId,
        from: new Date(query.from),
        to: new Date(query.to),
        ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
        ...(query.employeeId === undefined ? {} : { employeeId: query.employeeId }),
      });
      return rows.map((row) => ({
        assignmentId: row.assignmentId,
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        roleCode: row.roleCode,
        baseHourlyRate: row.baseHourlyRate,
        shiftId: row.shiftId,
        locationId: row.locationId,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        breakMinutes: row.breakMinutes,
        adjustedHours: row.adjustedHours,
      }));
    },
    createPayrollReport: async (input: NewPayrollReportRecord) =>
      toPayrollReport(
        await repo.createPayrollReport(db, {
          organizationId: input.organizationId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          generatedBy: input.generatedBy,
          status: input.status,
          snapshot: input.snapshot,
          createdBy: input.createdBy,
        }),
      ),
    findPayrollReport: async (query) => {
      const row = await repo.findPayrollReport(db, {
        organizationId: query.organizationId,
        payrollReportId: query.payrollReportId,
      });
      return row === undefined ? undefined : toPayrollReport(row);
    },
    findPayrollReportForPeriod: async (query) => {
      const row = await repo.findPayrollReportForPeriod(db, {
        organizationId: query.organizationId,
        periodStart: query.periodStart,
      });
      return row === undefined ? undefined : toPayrollReport(row);
    },
    lockPayrollReportForPeriod: async (query) => {
      const row = await repo.lockPayrollReportForPeriod(db, {
        organizationId: query.organizationId,
        periodStart: query.periodStart,
      });
      return row === undefined ? undefined : toPayrollReport(row);
    },
    listPayrollReports: async (query: PayrollReportListQuery) => {
      const rows = await repo.listPayrollReports(db, {
        organizationId: query.organizationId,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.periodStartFrom === undefined ? {} : { periodStartFrom: query.periodStartFrom }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toPayrollReport);
    },
    updatePayrollReport: async (input: UpdatePayrollReportRecord) => {
      const row = await repo.updatePayrollReport(db, {
        organizationId: input.organizationId,
        payrollReportId: input.payrollReportId,
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.snapshot === undefined ? {} : { snapshot: input.snapshot }),
        ...(input.exportFileId === undefined ? {} : { exportFileId: input.exportFileId }),
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      });
      return row === undefined ? undefined : toPayrollReport(row);
    },
    findEmployee: async (query): Promise<SchedulingEmployeeRecord | undefined> => {
      const row = await repo.findEmployee(db, {
        organizationId: query.organizationId,
        employeeId: query.employeeId,
      });
      return row === undefined
        ? undefined
        : {
            id: row.id,
            organizationId: row.organizationId,
            primaryLocationId: row.primaryLocationId,
            roleCode: row.roleCode,
            name: row.name,
            baseHourlyRate: row.baseHourlyRate,
          };
    },
  };
}
