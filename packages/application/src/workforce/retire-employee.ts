import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { WORKFORCE_AUDIT_ACTIONS } from "./actions";
import type { EmployeeRecord, WorkforceStore } from "./types";

export interface RetireEmployeeInput {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly actorId: string;
}

/**
 * Retires one employee (`WF-007`, `DEC-087`): the domain rule is **retired,
 * never deleted** (`03.10`), so this sets the `retiredAt` tombstone rather than
 * removing the row. The employee is loaded organization-scoped first
 * (`DEC-061`; a missing or cross-organization id is a typed `NotFoundError`).
 *
 * Retirement is idempotent and a repeat is a **true no-op**: an
 * already-retired employee is returned unchanged, with **no** second audit fact
 * and no `updated_by`/`updated_at` bump, so a retry cannot manufacture a
 * spurious `workforce.employee.retired` fact or move the tombstone. The (first)
 * amendment and its audit fact commit or roll back together.
 */
export async function retireEmployee(
  store: WorkforceStore,
  input: RetireEmployeeInput,
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

    // Already retired: return the existing row untouched and write no audit
    // fact. Re-retiring must not move `retired_at`, bump the audit columns or
    // append a second `workforce.employee.retired` fact — idempotency means the
    // repeat is a no-op, not another state change.
    if (employee.retiredAt !== null) {
      return employee;
    }

    const retiredAt = new Date().toISOString();

    const updated = await tx.updateEmployee({
      organizationId: input.organizationId,
      employeeId: employee.id,
      retiredAt,
      updatedBy: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("employee not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: WORKFORCE_AUDIT_ACTIONS.employeeRetired,
      entityType: "employee",
      entityId: updated.id,
      before: { retired_at: employee.retiredAt },
      after: { retired_at: updated.retiredAt },
    });

    return updated;
  });
}
