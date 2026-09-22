import type { AuditInput } from "../auth";

import { DEFAULT_SHIFT_ASSIGNMENT_LIMIT } from "./list-shift-assignments";
import { DEFAULT_SHIFT_LIMIT } from "./list-shifts";
import type {
  NewShiftAssignmentRecord,
  NewShiftRecord,
  SchedulingEmployeeRecord,
  SchedulingStore,
  ShiftAssignmentListQuery,
  ShiftAssignmentRecord,
  ShiftListQuery,
  ShiftRecord,
  UpdateShiftAssignmentRecord,
  UpdateShiftRecord,
} from "./types";

/**
 * A shallow copy of every mutable map/array a scheduling transaction can touch,
 * used to roll back a failed `withTransaction` (the fake runs inline without one).
 */
interface SchedulingSnapshot {
  readonly shifts: Map<string, ShiftRecord>;
  readonly shiftAssignments: Map<string, ShiftAssignmentRecord>;
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
      audits: [...this.audits],
    };
  }

  private restore(snapshot: SchedulingSnapshot): void {
    this.shifts.clear();
    for (const [key, value] of snapshot.shifts) this.shifts.set(key, value);
    this.shiftAssignments.clear();
    for (const [key, value] of snapshot.shiftAssignments) this.shiftAssignments.set(key, value);
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
 * the provisional assignment rule matches against (`WF-003`).
 */
export function seedSchedulingEmployee(
  store: FakeSchedulingStore,
  employee: {
    readonly id: string;
    readonly organizationId: string;
    readonly primaryLocationId: string | null;
  },
): void {
  store.employees.set(employee.id, {
    id: employee.id,
    organizationId: employee.organizationId,
    primaryLocationId: employee.primaryLocationId,
  });
}
