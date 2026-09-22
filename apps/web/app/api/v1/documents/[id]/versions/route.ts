import {
  createDocumentVersion,
  createPostgresDocumentsStore,
  findDocument,
  listDocumentVersions,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { getServerSession } from "../../../../../../lib/server-session";

import { DOCUMENT_MANAGE_ROLES, isDocumentAuthorized, loadDocumentAccess } from "../../access";
import {
  isUuid,
  parseCreateVersionBody,
  parseDocumentVersionListQuery,
  toDocumentVersionRows,
  writePaging,
} from "../../document-rows";
import { documentLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The version chain of one document (`DEC-088`, `DOC-002`): superseded versions
 * stay retrievable to **managers only** (a non-manager reading a published
 * document is served only its current published version through
 * `GET /document-versions/[id]`'s manager gate and `[id]`'s `currentVersion`).
 *
 * Query: `limit`/`offset`. Response: `{ ok: true, limit, offset, rows }`.
 * Signed out → 401; any role outside `DOCUMENT_MANAGE_ROLES` (owner /
 * general_manager / location_manager / admin) → 403; a non-UUID id or malformed
 * paging → 400; unknown/cross-organization document → 404.
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
    const access = await loadDocumentAccess(session.userId);
    if (!isDocumentAuthorized(access, DOCUMENT_MANAGE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseDocumentVersionListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresDocumentsStore(getDb().db);

    const document = await findDocument(store, { organizationId, documentId: id });
    if (document === undefined) {
      return jsonError(404);
    }

    const versions = await listDocumentVersions(store, {
      organizationId,
      documentId: id,
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      ...writePaging(parsed.query.limit, parsed.query.offset),
      rows: toDocumentVersionRows(organizationId, versions),
    });
  });
}

/**
 * Creates the next version of a document (`DEC-088`) — a managed action
 * (`DOCUMENT_MANAGE_ROLES`). The body carries the optional `fileObjectId` and
 * `notes`; the `version` number is assigned by the command.
 *
 * A non-UUID id or a malformed body (a non-UUID `fileObjectId`, an over-long
 * `notes`) is a 400. The document is resolved organization-scoped **before**
 * creating, so an unknown or cross-organization id is a 404 and cannot leak; a
 * command rejection is a 400, or a 404 when typed `NotFoundError`. Response:
 * `{ ok: true, documentVersionId, version }`.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, documentLimiters.createVersion, async () => {
    const { session } = await requireSession(request);
    const access = await loadDocumentAccess(session.userId);
    if (!isDocumentAuthorized(access, DOCUMENT_MANAGE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseCreateVersionBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresDocumentsStore(getDb().db);

    const document = await findDocument(store, { organizationId, documentId: id });
    if (document === undefined) {
      return jsonError(404);
    }

    let version;
    try {
      version = await createDocumentVersion(store, {
        organizationId,
        actorId: session.userId,
        documentId: id,
        fileObjectId: parsed.input.fileObjectId,
        notes: parsed.input.notes,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ documentVersionId: version.id, version: version.version });
  });
}
