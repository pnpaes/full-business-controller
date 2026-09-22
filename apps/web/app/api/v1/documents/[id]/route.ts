import {
  createPostgresDocumentsStore,
  findCurrentPublishedVersion,
  findDocument,
  updateDocument,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import {
  canReadDocument,
  DOCUMENT_MANAGE_ROLES,
  DOCUMENT_READ_ROLES,
  isDocumentAuthorized,
  loadDocumentAccess,
} from "../access";
import {
  isUuid,
  parseUpdateDocumentBody,
  toDocumentRow,
  toDocumentVersionRow,
} from "../document-rows";
import { documentLimiters } from "../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One document by id (`DEC-088`, `DOC-001`). Response
 * `{ ok: true, document, currentVersion }`.
 *
 * Signed out → 401; a role outside the read set → 403; a non-UUID id → 400. The
 * read is organization-scoped, so an unknown or cross-organization id is a 404
 * (`DEC-061`). The document is then checked with {@link canReadDocument}: a
 * non-manager may read only a **published** `all_staff` document, so a draft, an
 * archived document or a `managers`-audience document is a 403.
 *
 * `currentVersion` is the current published version (the greatest published
 * version); `null` when none. A newer unpublished version therefore never blanks
 * it — so a non-manager still sees the live version, and a manager still sees no
 * current version on a document with no published version.
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
    if (!isDocumentAuthorized(access, DOCUMENT_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresDocumentsStore(getDb().db);
    const document = await findDocument(store, { organizationId, documentId: id });
    if (document === undefined) {
      return jsonError(404);
    }
    if (!canReadDocument(access, document)) {
      return jsonError(403);
    }

    const current = await findCurrentPublishedVersion(store, { organizationId, documentId: id });
    const currentVersion =
      current === undefined ? null : (toDocumentVersionRow(organizationId, current) ?? null);

    const row = toDocumentRow(organizationId, document);
    if (row === undefined) {
      return jsonError(404);
    }

    return jsonOk({ document: row, currentVersion });
  });
}

/**
 * Amends one document's metadata (`DEC-088`). A managed action
 * (`DOCUMENT_MANAGE_ROLES`), the actor always the session user. The body is any
 * subset of `title`, `category`, `audience`, `ownerId` and `status`; publishing
 * is the version command, so `status` may only be **`"archived"`** (any other
 * value is a 400 from the parser).
 *
 * A non-UUID id or a malformed body is a 400. The document is resolved
 * organization-scoped **before** the command, so an unknown or
 * cross-organization id is a 404 and cannot leak; a command rejection is a 400,
 * or a 404 when typed `NotFoundError`.
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, documentLimiters.updateDocument, async () => {
    const { session } = await requireSession(request);
    const access = await loadDocumentAccess(session.userId);
    if (!isDocumentAuthorized(access, DOCUMENT_MANAGE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseUpdateDocumentBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresDocumentsStore(getDb().db);

    const existing = await findDocument(store, { organizationId, documentId: id });
    if (existing === undefined) {
      return jsonError(404);
    }

    let document;
    try {
      document = await updateDocument(store, {
        organizationId,
        actorId: session.userId,
        documentId: id,
        ...parsed.input,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ document: toDocumentRow(organizationId, document) });
  });
}
