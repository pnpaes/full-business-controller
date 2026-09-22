import { DomainError, NotFoundError } from "@aquarela/domain";

import { assertOptionalCalendarDate } from "../hms/register-incident";
import { isBlank } from "../inventory/validation";

import { WORKFORCE_AUDIT_ACTIONS } from "./actions";
import { assertBaseHourlyRate, EMPLOYMENT_TYPES } from "./register-employee";
import type { EmployeeRecord, WorkforceStore } from "./types";

export interface UpdateEmployeeInput {
  readonly organizationId: string;
  readonly employeeId: string;
  /** Non-empty; trimmed. Omitted leaves the name unchanged. */
  readonly name?: string;
  /** Free text; non-blank. Omitted leaves the role code unchanged. */
  readonly roleCode?: string;
  /** One of `EMPLOYMENT_TYPE`. Omitted leaves it unchanged. */
  readonly employmentType?: string;
  /** Decimal string (`numeric(19,4)`). Omitted leaves it unchanged. */
  readonly baseHourlyRate?: string;
  /** Omitted leaves it unchanged; `null` clears it. */
  readonly costCenterId?: string | null;
  /** Omitted leaves it unchanged; `null` clears it. */
  readonly primaryLocationId?: string | null;
  /** `date`, `YYYY-MM-DD`, or null to clear it; strictly after `activeFrom`. */
  readonly activeTo?: string | null;
  readonly actorId: string;
}

/** Patch field → audit payload key, so `before`/`after` share one shape. */
const AUDIT_FIELDS = {
  name: "name",
  roleCode: "role_code",
  employmentType: "employment_type",
  baseHourlyRate: "base_hourly_rate",
  costCenterId: "cost_center_id",
  primaryLocationId: "primary_location_id",
  activeTo: "active_to",
} as const;

/**
 * Amends one employee (`WF-007`, `DEC-087`). The row is loaded
 * organization-scoped first (`DEC-061`; a missing or cross-organization id is a
 * typed `NotFoundError`), then the patch is validated: `name`/`roleCode` stay
 * non-blank, `employmentType` stays in its vocabulary, `baseHourlyRate` stays a
 * non-negative `numeric(19,4)` decimal string and `activeTo` stays a `YYYY-MM-DD`
 * day strictly after the employee's immutable `activeFrom` (the
 * `employee_active_range_check` counterpart).
 *
 * `activeFrom` and `userId` are immutable after creation and are **not
 * patchable**; an empty patch is rejected. The update and its audit fact commit
 * or roll back together.
 */
export async function updateEmployee(
  store: WorkforceStore,
  input: UpdateEmployeeInput,
): Promise<EmployeeRecord> {
  if (isBlank(input.employeeId)) {
    throw new DomainError("employeeId is required");
  }

  return store.withTransaction(async (tx) => {
    const employee = await tx.findEmployee({
      organizationId: input.organizationId,
      employeeId: input.employeeId.trim(),
    });
    if (employee === undefined) {
      throw new NotFoundError("employee not found in organization");
    }

    const mutable: {
      name?: string;
      roleCode?: string;
      employmentType?: string;
      baseHourlyRate?: string;
      costCenterId?: string | null;
      primaryLocationId?: string | null;
      activeTo?: string | null;
    } = {};

    if (input.name !== undefined) {
      if (isBlank(input.name)) {
        throw new DomainError("name is required");
      }
      mutable.name = input.name.trim();
    }
    if (input.roleCode !== undefined) {
      if (isBlank(input.roleCode)) {
        throw new DomainError("roleCode is required");
      }
      mutable.roleCode = input.roleCode.trim();
    }
    if (input.employmentType !== undefined) {
      if (isBlank(input.employmentType)) {
        throw new DomainError("employmentType is required");
      }
      const employmentType = input.employmentType.trim();
      if (!EMPLOYMENT_TYPES.includes(employmentType)) {
        throw new DomainError(`employmentType must be one of ${EMPLOYMENT_TYPES.join(", ")}`);
      }
      mutable.employmentType = employmentType;
    }
    if (input.baseHourlyRate !== undefined) {
      mutable.baseHourlyRate = assertBaseHourlyRate(input.baseHourlyRate);
    }
    if (input.costCenterId !== undefined) {
      mutable.costCenterId = input.costCenterId;
    }
    if (input.primaryLocationId !== undefined) {
      mutable.primaryLocationId = input.primaryLocationId;
    }
    if (input.activeTo !== undefined) {
      assertOptionalCalendarDate(input.activeTo, "activeTo");
      if (input.activeTo !== null && input.activeTo <= employee.activeFrom) {
        throw new DomainError("activeTo must be after activeFrom");
      }
      mutable.activeTo = input.activeTo;
    }

    if (Object.keys(mutable).length === 0) {
      throw new DomainError("no updatable fields provided");
    }

    const updated = await tx.updateEmployee({
      organizationId: input.organizationId,
      employeeId: employee.id,
      ...mutable,
      updatedBy: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("employee not found in organization");
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of Object.keys(AUDIT_FIELDS) as (keyof typeof AUDIT_FIELDS)[]) {
      if (mutable[field] === undefined) continue;
      before[AUDIT_FIELDS[field]] = employee[field];
      after[AUDIT_FIELDS[field]] = updated[field];
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: WORKFORCE_AUDIT_ACTIONS.employeeUpdated,
      entityType: "employee",
      entityId: updated.id,
      before,
      after,
    });

    return updated;
  });
}
