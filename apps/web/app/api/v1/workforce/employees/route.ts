import {
  createPostgresWorkforceStore,
  listEmployees,
  registerEmployee,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import {
  isEmployeeInLocationScope,
  isWorkforceAuthorized,
  loadWorkforceAccess,
  WORKFORCE_EMPLOYEE_READ_ROLES,
  WORKFORCE_EMPLOYEE_WRITE_ROLES,
} from "../access";
import { workforceLimiters } from "../limiters";
import { parseCreateEmployeeBody, parseEmployeeListQuery, toEmployeeRows } from "../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The employee register for the served organization (`WF-007`, `DEC-087`),
 * ordered by `name` then id.
 *
 * Query: optional `primaryLocationId` (UUID), `active` (`true`/`false`),
 * `retired` (`true`/`false`) and `limit`/`offset`. Response:
 * `{ ok: true, limit, offset, rows }`. Signed out → 401; a role outside the read
 * set (owner / general_manager / location_manager / finance / admin — `analyst`,
 * `kitchen`, `front_of_house` and `purchasing` have no access, `DEC-099` item 6)
 * → 403; a malformed filter → 400. Never returns another organization's
 * employees (`DEC-061`).
 *
 * Location scope: an explicit `primaryLocationId` outside the caller's scope is
 * a 403, one inside it is passed through, and with no filter a single-location
 * caller is constrained in the query while a multi-location caller is filtered
 * in memory (the store filter takes one location, so that page may be short of
 * `limit` — the recorded ceiling, mirroring `hms/incidents/route.ts:59-84`). An
 * employee with a NULL `primary_location_id` is **not** visible to a scoped
 * caller (fail-closed) — see `isEmployeeInLocationScope`. A caller with no
 * location scope sees the whole organization.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseEmployeeListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const scope = access.locationIds;
    if (
      scope.length > 0 &&
      parsed.query.primaryLocationId !== undefined &&
      !scope.includes(parsed.query.primaryLocationId)
    ) {
      return jsonError(403);
    }
    const primaryLocationId =
      scope.length === 1 && parsed.query.primaryLocationId === undefined
        ? scope[0]
        : parsed.query.primaryLocationId;

    const organizationId = resolveOrganization();
    const store = createPostgresWorkforceStore(getDb().db);
    const employees = await listEmployees(store, {
      organizationId,
      ...(primaryLocationId === undefined ? {} : { primaryLocationId }),
      ...(parsed.query.active === undefined ? {} : { active: parsed.query.active }),
      ...(parsed.query.retired === undefined ? {} : { retired: parsed.query.retired }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });
    // Fail-closed: a scoped caller never sees an employee whose primary location
    // is null, nor one at another location.
    const visible =
      scope.length > 0
        ? employees.filter(
            (employee) =>
              employee.primaryLocationId !== null && scope.includes(employee.primaryLocationId),
          )
        : employees;

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toEmployeeRows(organizationId, visible),
    });
  });
}

/**
 * Registers one employee (`WF-007`, `DEC-087`). The actor is the session user,
 * the organization the served tenant. Read and write share the same role set
 * (`DEC-099` item 6): owner / general_manager / location_manager / finance /
 * admin.
 *
 * The body carries `name`, `roleCode`, `employmentType`, `baseHourlyRate`,
 * `activeFrom` and optional `userId`/`costCenterId`/`primaryLocationId`/
 * `activeTo`. A malformed body — including a bad `employmentType`, a float or
 * 5-decimal `baseHourlyRate`, or an `activeTo` at/before `activeFrom` — is a 400
 * from the parser. A location-scoped caller may only create an employee whose
 * `primaryLocationId` is in their scope; a null/absent primary location is
 * denied for them (fail-closed), since they could not manage the row afterwards.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, workforceLimiters.registerEmployee, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_WRITE_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseCreateEmployeeBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }
    if (!isEmployeeInLocationScope(access, parsed.input.primaryLocationId)) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresWorkforceStore(getDb().db);

    let employee;
    try {
      employee = await registerEmployee(store, {
        organizationId,
        actorId: session.userId,
        userId: parsed.input.userId,
        name: parsed.input.name,
        roleCode: parsed.input.roleCode,
        employmentType: parsed.input.employmentType,
        baseHourlyRate: parsed.input.baseHourlyRate,
        costCenterId: parsed.input.costCenterId,
        primaryLocationId: parsed.input.primaryLocationId,
        activeFrom: parsed.input.activeFrom,
        activeTo: parsed.input.activeTo,
      });
    } catch (error) {
      // `registerEmployee` creates a fresh row, so it has no `NotFoundError`
      // path (unlike retire/update); a typed rejection is a 400 with its
      // message.
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ employeeId: employee.id });
  });
}
