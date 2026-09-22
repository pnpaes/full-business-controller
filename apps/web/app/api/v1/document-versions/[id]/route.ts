import { createPostgresDocumentsStore, findDocumentVersion } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import {
  DOCUMENT_MANAGE_ROLES,
  isDocumentAuthorized,
  loadDocumentAccess,
} from "../../documents/access";
import { isUuid, toDocumentVersionRow } from "../../documents/document-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One document version by id (`DEC-088`, `DOC-002`). **Managers only**: a
 * superseded (non-current) version stays retrievable to managers, while a
 * non-manager is served only the current published version through
 * `GET /documents/[id]`'s `currentVersion`. Response:
 * `{ ok: true, documentVersion }`.
 *
 * Signed out → 401; any role outside `DOCUMENT_MANAGE_ROLES` (owner /
 * general_manager / location_manager / admin) → 403; a non-UUID id → 400. The
 * read is organization-scoped, so an unknown or cross-organization id is a 404
 * (`DEC-061`).
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
    const access = await loadDocumentAccess(session.userId);
    if (!isDocumentAuthorized(access, DOCUMENT_MANAGE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresDocumentsStore(getDb().db);
    const version = await findDocumentVersion(store, {
      organizationId,
      documentVersionId: id,
    });
    if (version === undefined) {
      return jsonError(404);
    }

    const row = toDocumentVersionRow(organizationId, version);
    if (row === undefined) {
      return jsonError(404);
    }

    return jsonOk({ documentVersion: row });
  });
}
