import { createPostgresHmsStore, findEquipment, listMaintenanceLogs } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { HMS_MAINTENANCE_READ_ROLES, isHmsAuthorized, loadHmsAccess } from "../access";
import { parseMaintenanceLogListQuery, toMaintenanceLogRows } from "../equipment-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Maintenance logs across the served organization (`HMS-006`, `DEC-092`), newest
 * `performedAt` first.
 *
 * Query: optional `equipmentId` (UUID), `kind`, plus `limit`/`offset`. Response:
 * `{ ok: true, limit, offset, rows }`. Signed out → 401; a role outside the read
 * set (owner / general_manager / location_manager / kitchen / front_of_house /
 * admin / analyst, `DEC-097`) → 403; a malformed filter → 400. Never returns
 * another organization's logs (`DEC-061`).
 *
 * ponytail: a `maintenance_log` carries no `location_id`, so a location-scoped
 * caller cannot be constrained by a plain read: such a caller **must** name an
 * `equipmentId` (403 without one). When an `equipmentId` is named it is resolved
 * org-scoped **for every caller** — unknown/missing → 404, another
 * organization's → 404 — and a resolved-but-out-of-scope equipment is a 403. An
 * unscoped caller may list freely without a filter. The ceiling is a mandatory
 * filter plus an extra `findEquipment` round-trip; the upgrade path is a
 * denormalized `location_id` on the log or a location-joined query.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_MAINTENANCE_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseMaintenanceLogListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    if (parsed.query.equipmentId !== undefined) {
      const equipment = await findEquipment(store, {
        organizationId,
        equipmentId: parsed.query.equipmentId,
      });
      if (equipment === undefined) {
        return jsonError(404);
      }
      if (!isHmsAuthorized(access, HMS_MAINTENANCE_READ_ROLES, equipment.locationId)) {
        return jsonError(403);
      }
    } else if (access.locationIds.length > 0) {
      return jsonError(403);
    }

    const logs = await listMaintenanceLogs(store, {
      organizationId,
      ...(parsed.query.equipmentId === undefined ? {} : { equipmentId: parsed.query.equipmentId }),
      ...(parsed.query.kind === undefined ? {} : { kind: parsed.query.kind }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toMaintenanceLogRows(organizationId, logs),
    });
  });
}
