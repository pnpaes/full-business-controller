import { createPostgresWorkforceStore, findEmployee, retireEmployee } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";

import {
  isEmployeeInLocationScope,
  isWorkforceAuthorized,
  loadWorkforceAccess,
  WORKFORCE_EMPLOYEE_WRITE_ROLES,
} from "../../../access";
import { workforceLimiters } from "../../../limiters";
import { isUuid } from "../../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retires one employee (`WF-007`, `DEC-087`): employees are **retired, never
 * deleted** (`03.10`), so this sets the `retired_at` tombstone rather than
 * removing the row. Retirement is idempotent and an amendment, so it shares the
 * employee write role set (owner / general_manager / location_manager /
 * finance / admin, `DEC-099` item 6).
 *
 * A non-UUID id is a 400. For a location-scoped caller the employee is resolved
 * org-scoped first — unknown/cross-organization → 404 — then the scope is
 * checked: another location's employee, or one with a **NULL**
 * `primary_location_id`, is a 403 (fail-closed). An unscoped caller's unknown id
 * surfaces as a 404 from the command. The actor is the session user.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, workforceLimiters.retireEmployee, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresWorkforceStore(getDb().db);

    if (access.locationIds.length > 0) {
      const employee = await findEmployee(store, { organizationId, employeeId: id });
      if (employee === undefined) {
        return jsonError(404);
      }
      if (!isEmployeeInLocationScope(access, employee.primaryLocationId)) {
        return jsonError(403);
      }
    }

    let employee;
    try {
      employee = await retireEmployee(store, {
        organizationId,
        actorId: session.userId,
        employeeId: id,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ employeeId: employee.id, retiredAt: employee.retiredAt });
  });
}
