import { SHIFT_ASSIGNMENT_STATE, SHIFT_STATE } from "@aquarela/persistence";

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
 * assignment rule matches against (`DEC-099` fail-closed precedent).
 */

/** The `shift_state` vocabulary a shift may hold (`SHIFT_STATE`). */
export const SHIFT_STATES: readonly string[] = SHIFT_STATE;

/** The `shift_assignment_state` vocabulary an assignment may hold. */
export const SHIFT_ASSIGNMENT_STATES: readonly string[] = SHIFT_ASSIGNMENT_STATE;

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

/** The mutable fields of an assignment; only `state` moves (withdrawn). */
export interface UpdateShiftAssignmentRecord {
  readonly organizationId: string;
  readonly shiftAssignmentId: string;
  /** One of `SHIFT_ASSIGNMENT_STATES`. */
  readonly state?: string;
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
 * The only `employee` fields the scheduling slice reads: the `primaryLocationId`
 * the provisional same-location assignment rule matches against and the
 * `roleCode` the `WF-003` role-match rule compares with the shift's role.
 */
export interface SchedulingEmployeeRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly primaryLocationId: string | null;
  readonly roleCode: string;
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
  /**
   * One employee by id, organization-scoped (`DEC-061`), or `undefined`,
   * projected to the fields the assignment rule needs.
   */
  findEmployee(query: {
    readonly organizationId: string;
    readonly employeeId: string;
  }): Promise<SchedulingEmployeeRecord | undefined>;
}
