import {
  createPostgresDocumentsStore,
  findDocumentVersion,
  publishDocumentVersion,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";

import {
  DOCUMENT_MANAGE_ROLES,
  isDocumentAuthorized,
  loadDocumentAccess,
} from "../../../documents/access";
import { isUuid, toDocumentVersionRow } from "../../../documents/document-rows";
import { documentLimiters } from "../../../documents/limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Publishes one document version (`DEC-088`, `DOC-002`) — a managed action
 * (`DOCUMENT_MANAGE_ROLES`: owner / general_manager / location_manager /
 * admin). Publishing is what makes a version the document's `currentVersion`
 * and what a non-manager can then read when the audience is `all_staff`.
 *
 * A non-UUID id is a 400. The version is resolved organization-scoped first, so
 * an unknown or cross-organization id is a 404 (`DEC-061`); `publishDocumentVersion`
 * needs the parent document id, so it is passed from the resolved version (the
 * path carries only the version id). A command rejection is a 400, or a 404 when
 * typed `NotFoundError`. Response: `{ ok: true, documentVersion }`.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, documentLimiters.publishVersion, async () => {
    const { session } = await requireSession(request);
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

    const existing = await findDocumentVersion(store, {
      organizationId,
      documentVersionId: id,
    });
    if (existing === undefined) {
      return jsonError(404);
    }

    let version;
    try {
      version = await publishDocumentVersion(store, {
        organizationId,
        actorId: session.userId,
        documentId: existing.documentId,
        documentVersionId: existing.id,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    const row = toDocumentVersionRow(organizationId, version);
    if (row === undefined) {
      return jsonError(404);
    }

    return jsonOk({ documentVersion: row });
  });
}
