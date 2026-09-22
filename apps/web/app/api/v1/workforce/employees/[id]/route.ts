import { createPostgresWorkforceStore, findEmployee, updateEmployee } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { getServerSession } from "../../../../../../lib/server-session";

import {
  isEmployeeInLocationScope,
  isWorkforceAuthorized,
  loadWorkforceAccess,
  WORKFORCE_EMPLOYEE_READ_ROLES,
  WORKFORCE_EMPLOYEE_WRITE_ROLES,
} from "../../access";
import { workforceLimiters } from "../../limiters";
import { isUuid, parseUpdateEmployeeBody, toEmployeeRow } from "../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One employee by id (`WF-007`, `DEC-087`).
 *
 * Signed out → 401; a role outside the read set → 403; a non-UUID id → 400. The
 * read is organization-scoped, so an unknown or cross-organization id is a 404
 * (`DEC-061`). For a location-scoped caller the employee is resolved
 * org-scoped first — unknown/missing → 404 — then the scope is checked: an
 * employee at another location, or with a **NULL** `primary_location_id`, is a
 * 403 (fail-closed, `isEmployeeInLocationScope`).
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresWorkforceStore(getDb().db);
    const employee = await findEmployee(store, { organizationId, employeeId: id });
    if (employee === undefined) {
      return jsonError(404);
    }
    if (!isEmployeeInLocationScope(access, employee.primaryLocationId)) {
      return jsonError(403);
    }

    return jsonOk({ employee: toEmployeeRow(organizationId, employee) });
  });
}

/**
 * Amends one employee (`WF-007`, `DEC-087`). The actor is the session user.
 * `activeFrom`/`userId` are immutable and `retiredAt` is set only by the retire
 * command, so the body is any subset of `name`, `roleCode`, `employmentType`,
 * `baseHourlyRate`, `costCenterId`, `primaryLocationId` and `activeTo`
 * (`null` clears an optional field).
 *
 * A malformed body (including a bad `employmentType` or money string) or a
 * non-UUID id is a 400, as is a command rejection (empty title/name, an
 * `activeTo` at/before the immutable `activeFrom`, no fields). For a
 * location-scoped caller the employee is resolved org-scoped first — unknown/
 * cross-organization → 404 — and both the **current** primary location and a
 * **body** `primaryLocationId` must be in scope (403 otherwise); setting it to
 * `null` is a 403 for a scoped caller (fail-closed).
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, workforceLimiters.updateEmployee, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseUpdateEmployeeBody(await readJsonObject(request));
    if (!parsed.ok) {
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
    if (
      parsed.input.primaryLocationId !== undefined &&
      !isEmployeeInLocationScope(access, parsed.input.primaryLocationId)
    ) {
      return jsonError(403);
    }

    let employee;
    try {
      employee = await updateEmployee(store, {
        organizationId,
        actorId: session.userId,
        employeeId: id,
        ...parsed.input,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ employee: toEmployeeRow(organizationId, employee) });
  });
}
