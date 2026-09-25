import {
  createPostgresFileObjectsStore,
  createPostgresHmsStore,
  createPostgresTaskStore,
  findIncident,
  listAssignableUsers,
  storeFileObject,
  updateIncident,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { getFileStorage } from "../../../../../../lib/file-storage";
import {
  isMultipart,
  parseUploadForm,
  rejectOversizeUpload,
} from "../../../../../../lib/file-upload";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { getServerSession } from "../../../../../../lib/server-session";

import {
  HMS_INCIDENT_EDIT_ROLES,
  HMS_INCIDENT_READ_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../access";
import {
  HMS_INCIDENT_RETENTION_POLICY,
  HMS_INCIDENT_UPLOAD_POLICY,
  isUuid,
  parseUpdateIncidentBody,
  toIncidentRow,
} from "../../incident-rows";
import { hmsLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Flattens a `multipart/form-data` body into the metadata object the shared
 * parser expects, dropping the `file` part: the evidence link is set from the
 * file actually stored, never a client claim (`ADR-0003`).
 */
function formBody(form: FormData): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key !== "file" && typeof value === "string") {
      body[key] = value;
    }
  }
  return body;
}

/**
 * One incident by id (`HMS-003`, `DEC-090`).
 *
 * Signed out → 401; a role outside the read set → 403; a non-UUID id → 400. The
 * read is organization-scoped, so an unknown or cross-organization id is a 404
 * (`DEC-061`). This is the referenced-row path
 * (`monitoring-points/[id]/readings/route.ts:68-76`): for a location-scoped
 * caller the incident is resolved org-scoped first — unknown/missing → 404,
 * an incident at another location → 403.
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
    if (!isHmsAuthorized(access, HMS_INCIDENT_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);
    const incident = await findIncident(store, { organizationId, incidentId: id });
    if (incident === undefined) {
      return jsonError(404);
    }
    if (!isHmsAuthorized(access, HMS_INCIDENT_READ_ROLES, incident.locationId)) {
      return jsonError(403);
    }

    return jsonOk({ incident: toIncidentRow(organizationId, incident) });
  });
}

/**
 * Amends or closes/reopens one incident (`HMS-003`, `DEC-090`). The actor is the
 * session user. Closing/reopening is an edit, so kitchen/front_of_house — which
 * may create and read — are denied here (`DEC-095`), as are `analyst`/`finance`/
 * `purchasing`.
 *
 * The body is any subset of `status`, `severity`, `ownerId`, `dueDate`, `title`
 * and `description` (`null` clears an optional field); `closedAt` is derived by
 * the command from `status`. An `ownerId` must name an active user of the served
 * organization (the same candidate-assignee read the owner picker uses) — an
 * unknown or cross-organization id is a 400. A malformed body or a non-UUID id
 * is a 400, as is a command rejection (unknown status/severity, empty title, no
 * fields). An unknown/cross-organization incident is a 404; a location-scoped
 * caller may only edit an incident at a location in their scope — resolved
 * org-scoped before the command, so another location's incident is a 403.
 *
 * Two body shapes are accepted (`DEC-134`): the JSON shape above, and a
 * `multipart/form-data` body that carries those same fields plus an optional
 * `file` part. A file is stored through the `DEC-132` port linked to the
 * incident (`linked_entity_type = 'hms_incident'`, the `DEC-095` link) with
 * `HMS_INCIDENT_RETENTION_POLICY`; a multipart body of only a file is a pure
 * evidence attach and updates no incident field. Attaching evidence is an
 * amendment, so it follows this route's `HMS_INCIDENT_EDIT_ROLES` gate: kitchen/
 * front_of_house may raise and read incidents (`DEC-095`) but do not amend them.
 * A type outside the evidence allow-list or over the cap is a 400 and stores
 * nothing. The response carries `fileObjectId` (null when no evidence was
 * attached) alongside the updated incident.
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, hmsLimiters.updateIncident, async () => {
    const { session } = await requireSession(request);
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_INCIDENT_EDIT_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    let parsedBody;
    let fileObjectId: string | null = null;
    if (isMultipart(request)) {
      const oversize = rejectOversizeUpload(request, HMS_INCIDENT_UPLOAD_POLICY);
      if (oversize !== undefined) {
        return oversize;
      }

      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return jsonError(400);
      }
      const parsed = parseUpdateIncidentBody(formBody(form));
      if (!parsed.ok) {
        return jsonError(400);
      }
      parsedBody = parsed;

      const filePart = form.get("file");
      const hasFile = filePart !== null && typeof filePart !== "string";
      if (Object.keys(parsed.input).length === 0 && !hasFile) {
        return jsonError(400);
      }

      // The incident is resolved org-scoped for every caller before evidence is
      // linked (unknown/cross-organization → 404) and a scoped caller's location
      // is applied (403), so a nonexistent link cannot surface as a raw FK error.
      const incident = await findIncident(store, { organizationId, incidentId: id });
      if (incident === undefined) {
        return jsonError(404);
      }
      if (!isHmsAuthorized(access, HMS_INCIDENT_EDIT_ROLES, incident.locationId)) {
        return jsonError(403);
      }

      if (hasFile) {
        const parsedUpload = await parseUploadForm(form, HMS_INCIDENT_UPLOAD_POLICY);
        if (!parsedUpload.ok) {
          return jsonError(400);
        }
        try {
          const file = await storeFileObject(
            createPostgresFileObjectsStore(getDb().db),
            getFileStorage(),
            {
              organizationId,
              actorId: session.userId,
              filename: parsedUpload.upload.filename,
              mime: parsedUpload.upload.mime,
              retentionPolicy: HMS_INCIDENT_RETENTION_POLICY,
              bytes: parsedUpload.upload.bytes,
              linkedEntityType: "hms_incident",
              linkedEntityId: id,
            },
          );
          fileObjectId = file.id;
        } catch (error) {
          if (error instanceof DomainError) {
            return jsonError(400, error.message);
          }
          throw error;
        }
      }
    } else {
      const parsed = parseUpdateIncidentBody(await readJsonObject(request));
      if (!parsed.ok) {
        return jsonError(400);
      }
      parsedBody = parsed;

      if (access.locationIds.length > 0) {
        const incident = await findIncident(store, { organizationId, incidentId: id });
        if (incident === undefined) {
          return jsonError(404);
        }
        if (!isHmsAuthorized(access, HMS_INCIDENT_EDIT_ROLES, incident.locationId)) {
          return jsonError(403);
        }
      }
    }

    // A multipart body of only a file is a pure evidence attach: nothing to
    // update, and the file object is the whole result.
    if (Object.keys(parsedBody.input).length === 0) {
      return jsonOk({ incidentId: id, fileObjectId });
    }

    const nextOwnerId = parsedBody.input.ownerId;
    if (nextOwnerId !== undefined && nextOwnerId !== null) {
      const owners = await listAssignableUsers(createPostgresTaskStore(getDb().db), {
        organizationId,
      });
      if (!owners.some((owner) => owner.id === nextOwnerId)) {
        return jsonError(400, "ownerId must be an active user in the organization");
      }
    }

    let incident;
    try {
      incident = await updateIncident(store, {
        organizationId,
        actorId: session.userId,
        incidentId: id,
        ...parsedBody.input,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ incident: toIncidentRow(organizationId, incident), fileObjectId });
  });
}
