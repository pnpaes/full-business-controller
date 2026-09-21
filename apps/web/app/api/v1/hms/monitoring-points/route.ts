import {
  createPostgresHmsStore,
  listMonitoringPoints,
  registerMonitoringPoint,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import { HMS_READ_ROLES, HMS_RECORD_ROLES, isHmsAuthorized, loadHmsAccess } from "../access";
import {
  parseCreateMonitoringPointBody,
  parseMonitoringPointListQuery,
  toMonitoringPointRows,
} from "../hms-rows";
import { hmsLimiters } from "../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Monitoring points for the served organization (`HMS-002`, `DEC-089`), ordered
 * by `code`.
 *
 * Query: optional `locationId` (UUID) and `activeOnly` (`true`/`false`), plus
 * `limit`/`offset`. Response: `{ ok: true, limit, offset, rows }`. Signed out →
 * 401; a role outside the read set (owner / general_manager / location_manager /
 * kitchen / front_of_house / admin / analyst) → 403; a malformed filter → 400.
 * Never returns another organization's points (`DEC-061`).
 *
 * This is the first route to enforce location scope (`07_SECURITY_AND_NFR.md`
 * §7.1). A location-scoped caller only sees their locations: an explicit
 * `locationId` outside that scope is a 403, one inside it is passed through, and
 * with no filter a single-location caller is constrained in the query while a
 * multi-location caller is filtered in memory (the store filter takes one
 * location, so that page may be short of `limit`). A caller with no location
 * scope sees the whole organization.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseMonitoringPointListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const scope = access.locationIds;
    if (
      scope.length > 0 &&
      parsed.query.locationId !== undefined &&
      !scope.includes(parsed.query.locationId)
    ) {
      return jsonError(403);
    }
    const locationId =
      scope.length === 1 && parsed.query.locationId === undefined
        ? scope[0]
        : parsed.query.locationId;

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);
    const points = await listMonitoringPoints(store, {
      organizationId,
      ...(locationId === undefined ? {} : { locationId }),
      ...(parsed.query.activeOnly === undefined ? {} : { activeOnly: parsed.query.activeOnly }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });
    const visible =
      scope.length > 0 ? points.filter((point) => scope.includes(point.locationId)) : points;

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toMonitoringPointRows(organizationId, visible),
    });
  });
}

/**
 * Registers a monitoring point (`HMS-002`). The actor is the session user and
 * the organization the served tenant. Recording is limited to the operational
 * roles (location_manager / kitchen / front_of_house) — `admin` may read but not
 * record, since there is no implicit admin bypass.
 *
 * The body carries `code`, `name`, `kind`, `unit`, `targetMin`, `targetMax`,
 * `checkFrequency`, `locationId` and an optional `storageAreaId`. A command
 * rejection (unknown kind/frequency, inverted target range, missing location) is
 * a 400. A location-scoped caller may only register a point at a location in
 * their scope (403 otherwise).
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, hmsLimiters.registerPoint, async () => {
    const { session } = await requireSession(request);
    const access = await loadHmsAccess(session.userId);

    const parsed = parseCreateMonitoringPointBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }
    if (!isHmsAuthorized(access, HMS_RECORD_ROLES, parsed.input.locationId)) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    let point;
    try {
      point = await registerMonitoringPoint(store, {
        organizationId,
        actorId: session.userId,
        locationId: parsed.input.locationId,
        storageAreaId: parsed.input.storageAreaId,
        code: parsed.input.code,
        name: parsed.input.name,
        kind: parsed.input.kind,
        unit: parsed.input.unit,
        targetMin: parsed.input.targetMin,
        targetMax: parsed.input.targetMax,
        checkFrequency: parsed.input.checkFrequency,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({
      monitoringPointId: point.id,
      code: point.code,
      active: point.active,
    });
  });
}
