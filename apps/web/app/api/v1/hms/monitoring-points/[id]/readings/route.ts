import {
  createPostgresHmsStore,
  findMonitoringPoint,
  listMonitoringReadings,
  recordMonitoringReading,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";
import { getServerSession } from "../../../../../../../lib/server-session";

import { HMS_READ_ROLES, HMS_RECORD_ROLES, isHmsAuthorized, loadHmsAccess } from "../../../access";
import {
  isUuid,
  parseMonitoringReadingListQuery,
  parseRecordMonitoringReadingBody,
  toMonitoringReadingRows,
} from "../../../hms-rows";
import { hmsLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readings for one monitoring point (`HMS-002`, `DEC-089`), newest `measuredAt`
 * first.
 *
 * Query: optional `limit`/`offset`. Response: `{ ok: true, limit, offset, rows }`.
 * Signed out → 401; a role outside the read set → 403; a non-UUID point id or a
 * malformed page → 400. The read is organization-scoped, so another
 * organization's point id yields an empty page, never foreign readings
 * (`DEC-061`). A location-scoped caller may only read a point at a location in
 * their scope: an unknown/cross-organization point is a 404 (indistinguishable
 * from a missing one), a point at another location a 403.
 */
export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseMonitoringReadingListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    if (access.locationIds.length > 0) {
      const point = await findMonitoringPoint(store, { organizationId, monitoringPointId: id });
      if (point === undefined) {
        return jsonError(404);
      }
      if (!isHmsAuthorized(access, HMS_READ_ROLES, point.locationId)) {
        return jsonError(403);
      }
    }

    const readings = await listMonitoringReadings(store, {
      organizationId,
      monitoringPointId: id,
      ...parsed.query,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toMonitoringReadingRows(organizationId, readings),
    });
  });
}

/**
 * Records a reading against the point (`HMS-002`): the value, the instant it was
 * measured at and optional notes. The unit and the `inRange` verdict are derived
 * by the command from the point, so the body cannot set them. The actor is the
 * session user; recording requires an operational role (location_manager /
 * kitchen / front_of_house).
 *
 * A malformed body or a non-UUID id is a 400, as is a command rejection
 * (unparseable decimal, malformed instant). An unknown or cross-organization
 * point is a typed `NotFoundError` → 404. A location-scoped caller may only
 * record against a point at a location in their scope — resolved through
 * `findMonitoringPoint` before the command so another location's point is a 403
 * (an unknown/cross-organization point stays a 404).
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, hmsLimiters.recordReading, async () => {
    const { session } = await requireSession(request);
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_RECORD_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseRecordMonitoringReadingBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    if (access.locationIds.length > 0) {
      const point = await findMonitoringPoint(store, { organizationId, monitoringPointId: id });
      if (point === undefined) {
        return jsonError(404);
      }
      if (!isHmsAuthorized(access, HMS_RECORD_ROLES, point.locationId)) {
        return jsonError(403);
      }
    }

    let reading;
    try {
      reading = await recordMonitoringReading(store, {
        organizationId,
        actorId: session.userId,
        monitoringPointId: id,
        value: parsed.input.value,
        measuredAt: parsed.input.measuredAt,
        notes: parsed.input.notes,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({
      monitoringReadingId: reading.id,
      value: reading.value,
      unit: reading.unit,
      inRange: reading.inRange,
    });
  });
}
