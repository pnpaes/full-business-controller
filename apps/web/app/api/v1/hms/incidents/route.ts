import { createPostgresHmsStore, listIncidents, registerIncident } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import {
  HMS_INCIDENT_CREATE_ROLES,
  HMS_INCIDENT_READ_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../access";
import { parseCreateIncidentBody, parseIncidentListQuery, toIncidentRows } from "../incident-rows";
import { hmsLimiters } from "../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The incident register for the served organization (`HMS-003`, `DEC-090`),
 * newest `occurredAt` first.
 *
 * Query: optional `status` and `locationId` (UUID), plus `limit`/`offset`.
 * Response: `{ ok: true, limit, offset, rows }`. Signed out → 401; a role
 * outside the read set (owner / general_manager / location_manager / kitchen /
 * front_of_house / admin — `analyst`/`finance`/`purchasing` have no access,
 * `DEC-095`) → 403; a malformed filter → 400. Never returns another
 * organization's incidents (`DEC-061`).
 *
 * Location scope mirrors the monitoring routes
 * (`monitoring-points/route.ts:61-84`): an explicit `locationId` outside the
 * caller's scope is a 403, one inside it is passed through, and with no filter a
 * single-location caller is constrained in the query while a multi-location
 * caller is filtered in memory (the store filter takes one location, so that
 * page may be short of `limit`). A caller with no location scope sees the whole
 * organization.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_INCIDENT_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseIncidentListQuery(new URL(request.url).searchParams);
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
    const incidents = await listIncidents(store, {
      organizationId,
      ...(parsed.query.status === undefined ? {} : { status: parsed.query.status }),
      ...(locationId === undefined ? {} : { locationId }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });
    const visible =
      scope.length > 0
        ? incidents.filter((incident) => scope.includes(incident.locationId))
        : incidents;

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toIncidentRows(organizationId, visible),
    });
  });
}

/**
 * Registers an incident (`HMS-003`, `DEC-090`). The actor and reporter are the
 * session user (`reportedBy`), the organization is the served tenant and a new
 * incident always starts `open`. Kitchen and front_of_house may raise an
 * incident; `admin` may read and close/reopen but not create (`DEC-095`, no
 * implicit admin bypass).
 *
 * The body carries `locationId`, `category`, `severity`, `occurredAt`, an
 * optional `reportedAt` (defaulting to now), optional `ownerId`/`dueDate`/
 * `description`, `title` and `involvesPersonalData`. A command rejection
 * (unknown category/severity, malformed instant) is a 400. A location-scoped
 * caller may only register an incident at a location in their scope (403
 * otherwise).
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, hmsLimiters.registerIncident, async () => {
    const { session } = await requireSession(request);
    const access = await loadHmsAccess(session.userId);

    const parsed = parseCreateIncidentBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }
    if (!isHmsAuthorized(access, HMS_INCIDENT_CREATE_ROLES, parsed.input.locationId)) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    let incident;
    try {
      incident = await registerIncident(store, {
        organizationId,
        actorId: session.userId,
        locationId: parsed.input.locationId,
        category: parsed.input.category,
        severity: parsed.input.severity,
        occurredAt: parsed.input.occurredAt,
        reportedAt: parsed.input.reportedAt ?? new Date().toISOString(),
        reportedBy: session.userId,
        ownerId: parsed.input.ownerId,
        title: parsed.input.title,
        description: parsed.input.description,
        dueDate: parsed.input.dueDate,
        involvesPersonalData: parsed.input.involvesPersonalData,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ incidentId: incident.id, status: incident.status });
  });
}
