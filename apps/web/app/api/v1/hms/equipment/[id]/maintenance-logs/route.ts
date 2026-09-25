import {
  createPostgresFileObjectsStore,
  createPostgresHmsStore,
  findEquipment,
  listMaintenanceLogs,
  recordMaintenanceLog,
  storeFileObject,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { getFileStorage } from "../../../../../../../lib/file-storage";
import { isMultipart, parseUploadForm } from "../../../../../../../lib/file-upload";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";
import { getServerSession } from "../../../../../../../lib/server-session";

import {
  HMS_MAINTENANCE_READ_ROLES,
  HMS_MAINTENANCE_RECORD_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../../access";
import {
  HMS_MAINTENANCE_RETENTION_POLICY,
  HMS_MAINTENANCE_UPLOAD_POLICY,
  isUuid,
  parseMaintenanceLogPageQuery,
  parseRecordMaintenanceLogBody,
  toMaintenanceLogRows,
} from "../../../equipment-rows";
import { hmsLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Flattens a `multipart/form-data` body into the metadata object the shared
 * parser expects, dropping the `file` part and any client `fileObjectId`: the
 * link is set from the file actually stored, never a client claim (`ADR-0003`).
 */
function formBody(form: FormData): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key !== "file" && key !== "fileObjectId" && typeof value === "string") {
      body[key] = value;
    }
  }
  return body;
}

/**
 * Maintenance logs recorded against one equipment row (`HMS-006`, `DEC-092`),
 * newest `performedAt` first.
 *
 * Query: `limit`/`offset` only. Response: `{ ok: true, limit, offset, rows }`.
 * Signed out → 401; a role outside the read set (owner / general_manager /
 * location_manager / kitchen / front_of_house / admin / analyst, `DEC-097`) →
 * 403; a non-UUID id or a malformed page → 400. Never returns another
 * organization's logs (`DEC-061`).
 *
 * ponytail: a `maintenance_log` carries no `location_id` (the same ceiling
 * recorded for `corrective_action`), so a location-scoped caller's scope is
 * derived from the equipment: the equipment is resolved org-scoped **for every
 * caller** — unknown/missing → 404, another organization's → 404 — and a
 * resolved-but-out-of-scope equipment is a 403 for a scoped caller; only then
 * are its logs listed. The ceiling is an extra `findEquipment` round-trip and a
 * per-request resolution; the upgrade path is a denormalized `location_id` on
 * the log or a location-joined query.
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
    if (!isHmsAuthorized(access, HMS_MAINTENANCE_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseMaintenanceLogPageQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    const equipment = await findEquipment(store, { organizationId, equipmentId: id });
    if (equipment === undefined) {
      return jsonError(404);
    }
    if (!isHmsAuthorized(access, HMS_MAINTENANCE_READ_ROLES, equipment.locationId)) {
      return jsonError(403);
    }

    const logs = await listMaintenanceLogs(store, {
      organizationId,
      equipmentId: id,
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

/**
 * Records one maintenance-log fact against the equipment in the path
 * (`HMS-006`, `DEC-092`) — create only; a log is a fact log with no update or
 * delete command. Recording is operational, so owner / general_manager /
 * location_manager / kitchen / front_of_house / admin may do it (`DEC-097`);
 * `analyst` may read but not record, and `purchasing`/`finance` have no access.
 *
 * The actor and `performedBy` are the session user; the equipment link is the
 * path id, so the body carries `kind` (checked against `MAINTENANCE_KINDS`), the
 * `performedAt` instant and optional `notes`. Two body shapes are accepted:
 * `multipart/form-data` with an optional `file` part stores the evidence through
 * the `DEC-132` port (linked to the equipment) and records the log with
 * `fileObjectId` (`DEC-133`); the JSON shape remains metadata-only. A file whose
 * type is outside the evidence allow-list or over the size cap is a 400 and
 * stores nothing. A malformed body or a non-UUID id is a 400.
 *
 * The equipment is resolved org-scoped for every caller — an unknown or
 * cross-organization id is a 404 (so a nonexistent link cannot surface as a raw
 * FK error) — and a location-scoped caller may only add to equipment at a
 * location in their scope (403).
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, hmsLimiters.recordMaintenanceLog, async () => {
    const { session } = await requireSession(request);
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_MAINTENANCE_RECORD_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    const equipment = await findEquipment(store, { organizationId, equipmentId: id });
    if (equipment === undefined) {
      return jsonError(404);
    }
    if (!isHmsAuthorized(access, HMS_MAINTENANCE_RECORD_ROLES, equipment.locationId)) {
      return jsonError(403);
    }

    let parsedBody;
    let fileObjectId: string | null = null;
    if (isMultipart(request)) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return jsonError(400);
      }
      parsedBody = parseRecordMaintenanceLogBody(formBody(form));
      if (!parsedBody.ok) {
        return jsonError(400);
      }

      const filePart = form.get("file");
      if (filePart !== null && typeof filePart !== "string") {
        const parsedUpload = await parseUploadForm(form, HMS_MAINTENANCE_UPLOAD_POLICY);
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
              retentionPolicy: HMS_MAINTENANCE_RETENTION_POLICY,
              bytes: parsedUpload.upload.bytes,
              linkedEntityType: "equipment",
              linkedEntityId: equipment.id,
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
      const parsed = parseRecordMaintenanceLogBody(await readJsonObject(request));
      if (!parsed.ok) {
        return jsonError(400);
      }
      parsedBody = parsed;
      fileObjectId = parsed.input.fileObjectId;
    }

    let log;
    try {
      log = await recordMaintenanceLog(store, {
        organizationId,
        actorId: session.userId,
        equipmentId: id,
        kind: parsedBody.input.kind,
        performedAt: parsedBody.input.performedAt,
        performedBy: session.userId,
        notes: parsedBody.input.notes,
        fileObjectId,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ maintenanceLogId: log.id, fileObjectId: log.fileObjectId });
  });
}
