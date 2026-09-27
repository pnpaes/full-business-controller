import { createPostgresInventoryStore, setLocationDefaultStorageArea } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { getServerSession } from "../../../../../../lib/server-session";
import {
  ADMIN_LOCATION_DEFAULT_ROLES,
  isAdministrationAuthorized,
  loadAdministrationAccess,
} from "../../access";
import { isUuid } from "../../admin-rows";
import { administrationLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sets a location's default storage area (`DEC-145`), the area a goods receipt
 * resolves to when it carries no explicit per-receipt override.
 *
 * Body: `{ locationId, storageAreaId }` (both UUIDs). Response:
 * `{ ok: true, locationId, storageAreaId }`. Signed out → 401; a role outside
 * `ADMIN_LOCATION_DEFAULT_ROLES` (owner / general_manager / admin) → 403; a
 * malformed body or a command rejection (foreign location/area, area not of the
 * location) → 400. The organization and actor come from the session, never the
 * body. Never touches another organization's location.
 */
export async function POST(request: Request): Promise<Response> {
  return mapErrors(() =>
    withMutationGuards(request, administrationLimiters.setLocationDefaultStorageArea, async () => {
      const session = await getServerSession();
      if (session === undefined) {
        return jsonError(401);
      }

      const access = await loadAdministrationAccess(session.userId);
      if (!isAdministrationAuthorized(access, ADMIN_LOCATION_DEFAULT_ROLES)) {
        return jsonError(403);
      }

      const body = await readJsonObject(request);
      if (body === undefined) {
        return jsonError(400);
      }
      const rawLocationId = body["locationId"];
      const rawStorageAreaId = body["storageAreaId"];
      const locationId = typeof rawLocationId === "string" ? rawLocationId.trim() : "";
      const storageAreaId = typeof rawStorageAreaId === "string" ? rawStorageAreaId.trim() : "";
      if (!isUuid(locationId) || !isUuid(storageAreaId)) {
        return jsonError(400);
      }

      const organizationId = resolveOrganization();
      const store = createPostgresInventoryStore(getDb().db);
      try {
        const result = await setLocationDefaultStorageArea(store, {
          organizationId,
          actorId: session.userId,
          locationId,
          storageAreaId,
        });
        return jsonOk({ locationId: result.locationId, storageAreaId: result.storageAreaId });
      } catch (error) {
        if (error instanceof DomainError) {
          return jsonError(400, error.message);
        }
        throw error;
      }
    }),
  );
}
