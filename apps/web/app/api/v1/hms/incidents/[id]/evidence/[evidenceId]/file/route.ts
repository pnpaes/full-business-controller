import {
  createPostgresFileObjectsStore,
  createPostgresHmsStore,
  findIncident,
  readFileObject,
} from "@aquarela/application";

import { getDb } from "../../../../../../../../../lib/db";
import { getFileStorage } from "../../../../../../../../../lib/file-storage";
import { fileAttachmentResponse } from "../../../../../../../../../lib/file-upload";
import { jsonError, mapErrors } from "../../../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../../../lib/organization";
import { getServerSession } from "../../../../../../../../../lib/server-session";

import { HMS_INCIDENT_READ_ROLES, isHmsAuthorized, loadHmsAccess } from "../../../../../access";
import { isUuid } from "../../../../../hms-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams one evidence attachment of one incident (`DEC-134`), the download half
 * of the incident-evidence consumer. Incident evidence is a one-to-many
 * polymorphic list (`DEC-095`: `file_object.linked_entity_type = 'hms_incident'`,
 * no `file_object_id` column), so the path carries both the incident and the
 * file object.
 *
 * Gated on the incident read set, with the incident resolved organization-scoped
 * first (`DEC-061`; unknown or cross-organization → 404) and a scoped caller's
 * location applied (403). The file object is then resolved organization-scoped,
 * and the route additionally requires it to be linked to **this** incident — so
 * the route cannot be used to fetch an arbitrary file object of the same
 * organization, and a file linked elsewhere is a 404. A missing file object (or
 * one outside the organization) is a 404.
 */
export async function GET(
  _request: Request,
  context: {
    readonly params: Promise<{ readonly id: string; readonly evidenceId: string }>;
  },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_INCIDENT_READ_ROLES)) {
      return jsonError(403);
    }

    const { id, evidenceId } = await context.params;
    if (!isUuid(id) || !isUuid(evidenceId)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const db = getDb().db;
    const store = createPostgresHmsStore(db);

    const incident = await findIncident(store, { organizationId, incidentId: id });
    if (incident === undefined) {
      return jsonError(404);
    }
    if (!isHmsAuthorized(access, HMS_INCIDENT_READ_ROLES, incident.locationId)) {
      return jsonError(403);
    }

    const stored = await readFileObject(createPostgresFileObjectsStore(db), getFileStorage(), {
      organizationId,
      fileObjectId: evidenceId,
    });
    if (stored === undefined) {
      return jsonError(404);
    }
    if (
      stored.metadata.linkedEntityType !== "hms_incident" ||
      stored.metadata.linkedEntityId !== incident.id
    ) {
      return jsonError(404);
    }

    return fileAttachmentResponse(stored);
  });
}
