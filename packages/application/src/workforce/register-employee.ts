import { DomainError, MONEY_SCALE, parseDecimal } from "@aquarela/domain";
import { EMPLOYMENT_TYPE } from "@aquarela/persistence";

import { assertOptionalCalendarDate } from "../hms/register-incident";
import { isBlank } from "../inventory/validation";

import { WORKFORCE_AUDIT_ACTIONS } from "./actions";
import type { EmployeeRecord, WorkforceStore } from "./types";

/** The `employment_type` vocabulary an employee may hold (`EMPLOYMENT_TYPE`). */
export const EMPLOYMENT_TYPES: readonly string[] = EMPLOYMENT_TYPE;

/**
 * Validates a `numeric(19,4)` money string (`DEC-087`): a plain decimal string
 * (a JS number — a float — is rejected), non-negative, at most four decimal
 * places and fitting the column's precision. The shape, decimal-place and
 * precision rules come from the domain `parseDecimal` at `MONEY_SCALE`; the
 * non-negative rule is the `employee_base_hourly_rate_check` counterpart applied
 * here so the fake-store suite and the API see one `DomainError`. The trimmed
 * string is returned, and decimals are never coerced to a number.
 */
export function assertBaseHourlyRate(value: unknown): string {
  if (typeof value !== "string") {
    throw new DomainError("baseHourlyRate must be a decimal string");
  }
  const trimmed = value.trim();
  const scaled = parseDecimal(trimmed, MONEY_SCALE);
  if (scaled < 0n) {
    throw new DomainError("baseHourlyRate must not be negative");
  }
  return trimmed;
}

/** The most positions one employee may hold in a single set (a sanity bound). */
export const MAX_EMPLOYEE_POSITIONS = 50;

export interface RegisterEmployeeInput {
  readonly organizationId: string;
  /** Optional `app_user` login; an employee may exist without one (`WF-001`). */
  readonly userId?: string | null;
  readonly name: string;
  /** `DEC-151`: an existing organization role code (validated against `role`). */
  readonly roleCode: string;
  /** One of `EMPLOYMENT_TYPE`. */
  readonly employmentType: string;
  /** Decimal string (`numeric(19,4)`, money — never a float). */
  readonly baseHourlyRate: string;
  /** Plain uuid; the cost-centre FK is a deferred slice. */
  readonly costCenterId?: string | null;
  /** Nullable FK to `location.id`; guarded same-organization by `0047`. */
  readonly primaryLocationId?: string | null;
  /** `date`, `YYYY-MM-DD`. */
  readonly activeFrom: string;
  /** `date`, `YYYY-MM-DD`, or null; strictly after `activeFrom` when set. */
  readonly activeTo?: string | null;
  /** `DEC-151`: the initial positions (validated against the catalogue, deduped). */
  readonly positionIds?: readonly string[];
  readonly actorId: string;
}

/**
 * Normalises and validates an employee's position set (`DEC-151`): every id must
 * be a position in the caller's organization, and the set is trimmed, deduped
 * and bounded (`MAX_EMPLOYEE_POSITIONS`). Runs against the transaction store so
 * the ids are read at the same scope the grant is written.
 */
export async function normalizeEmployeePositionIds(
  store: WorkforceStore,
  organizationId: string,
  positionIds: readonly string[] | undefined,
): Promise<readonly string[]> {
  const unique = [...new Set((positionIds ?? []).map((id) => id.trim()).filter((id) => id !== ""))];
  if (unique.length > MAX_EMPLOYEE_POSITIONS) {
    throw new DomainError(`an employee may hold at most ${MAX_EMPLOYEE_POSITIONS} positions`);
  }
  for (const positionId of unique) {
    const found = await store.findPosition({ organizationId, positionId });
    if (found === undefined) {
      throw new DomainError(`position ${positionId} not found in organization`);
    }
  }
  return unique;
}

/**
 * Registers one employee (`WF-007`, `DEC-087`): validates the required
 * `name`/`roleCode`/`employmentType` text and vocabulary, the `baseHourlyRate`
 * money string, and the `activeFrom`/`activeTo` calendar dates (the range must be
 * strictly increasing), then creates the row and its audit fact in one
 * transaction. The create is organization-scoped through `input.organizationId`
 * (`DEC-061`).
 *
 * `role_code` (`DEC-151`) is validated against the organization's `role` rows
 * (the fixed access vocabulary) and the position set against the open catalogue;
 * both are database-backed by the `0080` FK and guard triggers. The employment
 * type and active-range checks are
 * database-backed (`employee_employment_type_check`,
 * `employee_active_range_check`), and `primary_location_id` has a same-organization
 * guard (`0047`), but they are mirrored here so the fake-store unit suite and the
 * API see one error class (`DomainError`) rather than a driver constraint
 * violation.
 *
 * `assertOptionalCalendarDate` is reused from the HMS slice (`register-incident.ts`)
 * so the `date` wire form (`YYYY-MM-DD`, rejecting an impossible day) has one
 * implementation across both domains.
 */
export async function registerEmployee(
  store: WorkforceStore,
  input: RegisterEmployeeInput,
): Promise<EmployeeRecord> {
  if (isBlank(input.name)) {
    throw new DomainError("name is required");
  }
  if (isBlank(input.roleCode)) {
    throw new DomainError("roleCode is required");
  }
  if (isBlank(input.employmentType)) {
    throw new DomainError("employmentType is required");
  }
  const employmentType = input.employmentType.trim();
  if (!EMPLOYMENT_TYPES.includes(employmentType)) {
    throw new DomainError(`employmentType must be one of ${EMPLOYMENT_TYPES.join(", ")}`);
  }
  const baseHourlyRate = assertBaseHourlyRate(input.baseHourlyRate);
  if (isBlank(input.activeFrom)) {
    throw new DomainError("activeFrom is required");
  }
  assertOptionalCalendarDate(input.activeFrom, "activeFrom");
  assertOptionalCalendarDate(input.activeTo, "activeTo");
  if (
    input.activeTo !== undefined &&
    input.activeTo !== null &&
    input.activeTo <= input.activeFrom
  ) {
    throw new DomainError("activeTo must be after activeFrom");
  }

  const roleCode = input.roleCode.trim();

  return store.withTransaction(async (tx) => {
    const role = await tx.findRoleByCode({ organizationId: input.organizationId, code: roleCode });
    if (role === undefined) {
      throw new DomainError(`role ${roleCode} is not one of the organization's roles`);
    }
    const positionIds = await normalizeEmployeePositionIds(
      tx,
      input.organizationId,
      input.positionIds,
    );

    const employee = await tx.createEmployee({
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      name: input.name.trim(),
      roleCode,
      employmentType,
      baseHourlyRate,
      costCenterId: input.costCenterId ?? null,
      primaryLocationId: input.primaryLocationId ?? null,
      activeFrom: input.activeFrom,
      activeTo: input.activeTo ?? null,
      positionIds,
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: WORKFORCE_AUDIT_ACTIONS.employeeCreated,
      entityType: "employee",
      entityId: employee.id,
      after: {
        user_id: employee.userId,
        name: employee.name,
        role_code: employee.roleCode,
        employment_type: employee.employmentType,
        base_hourly_rate: employee.baseHourlyRate,
        cost_center_id: employee.costCenterId,
        primary_location_id: employee.primaryLocationId,
        active_from: employee.activeFrom,
        active_to: employee.activeTo,
        position_ids: employee.positionIds,
        retired_at: employee.retiredAt,
      },
    });

    return employee;
  });
}
