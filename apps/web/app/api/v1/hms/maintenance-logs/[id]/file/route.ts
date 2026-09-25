import {
  createPostgresFileObjectsStore,
  createPostgresHmsStore,
  findEquipment,
  findMaintenanceLog,
  readFileObject,
} from "@aquarela/application";

import { getDb } from "../../../../../../../lib/db";
import { getFileStorage } from "../../../../../../../lib/file-storage";
import { fileAttachmentResponse } from "../../../../../../../lib/file-upload";
import { jsonError, mapErrors } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { getServerSession } from "../../../../../../../lib/server-session";

import { HMS_MAINTENANCE_READ_ROLES, isHmsAuthorized, loadHmsAccess } from "../../../access";
import { isUuid } from "../../../equipment-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the stored evidence of one maintenance log (`DEC-133`), the download
 * half of the maintenance-evidence consumer.
 *
 * Gated on the maintenance read set, with the same location derivation as the
 * list route: `maintenance_log` carries no `location_id`, so the log's
 * equipment is resolved to apply a scoped caller's location. Both the log and
 * the file object are resolved **organization-scoped** (`DEC-061`), so an
 * unknown or cross-organization id is a 404 and cannot leak; an out-of-scope
 * equipment for a scoped caller is a 403. A log with no evidence is a 404.
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
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_MAINTENANCE_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const db = getDb().db;
    const store = createPostgresHmsStore(db);

    const log = await findMaintenanceLog(store, { organizationId, maintenanceLogId: id });
    if (log === undefined) {
      return jsonError(404);
    }
    const equipment = await findEquipment(store, {
      organizationId,
      equipmentId: log.equipmentId,
    });
    if (equipment === undefined) {
      return jsonError(404);
    }
    if (!isHmsAuthorized(access, HMS_MAINTENANCE_READ_ROLES, equipment.locationId)) {
      return jsonError(403);
    }
    if (log.fileObjectId === null) {
      return jsonError(404);
    }

    const stored = await readFileObject(createPostgresFileObjectsStore(db), getFileStorage(), {
      organizationId,
      fileObjectId: log.fileObjectId,
    });
    if (stored === undefined) {
      return jsonError(404);
    }

    return fileAttachmentResponse(stored);
  });
}
