import {
  acknowledgeDocument,
  createPostgresDocumentsStore,
  findDocument,
  listDocumentAcknowledgements,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { getServerSession } from "../../../../../../lib/server-session";

import {
  canReadDocument,
  DOCUMENT_MANAGE_ROLES,
  DOCUMENT_READ_ROLES,
  isDocumentAuthorized,
  loadDocumentAccess,
} from "../../access";
import {
  isUuid,
  parseAcknowledgeBody,
  parseAcknowledgementListQuery,
  toAcknowledgementRow,
  toAcknowledgementRows,
  writePaging,
} from "../../document-rows";
import { documentLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The acknowledgement register of one document (`DEC-088`, `DOC-003`).
 * Managers only (`DOCUMENT_MANAGE_ROLES`): who has acknowledged which version is
 * an audit view, like the superseded-version chain. The path document scopes the
 * read (`documentId` on the query), so one document's register never leaks
 * another's.
 *
 * Query: optional `documentVersionId`/`acknowledgedBy` plus `limit`/`offset`.
 * Response: `{ ok: true, limit, offset, rows }`. Signed out → 401; a
 * non-manager → 403; a non-UUID id/filter or malformed paging → 400; an unknown
 * or cross-organization document → 404.
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

    const parsed = parseAcknowledgementListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresDocumentsStore(getDb().db);

    const document = await findDocument(store, { organizationId, documentId: id });
    if (document === undefined) {
      return jsonError(404);
    }

    const acknowledgements = await listDocumentAcknowledgements(store, {
      organizationId,
      documentId: id,
      ...(parsed.query.documentVersionId === undefined
        ? {}
        : { documentVersionId: parsed.query.documentVersionId }),
      ...(parsed.query.acknowledgedBy === undefined
        ? {}
        : { acknowledgedBy: parsed.query.acknowledgedBy }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      ...writePaging(parsed.query.limit, parsed.query.offset),
      rows: toAcknowledgementRows(organizationId, acknowledgements),
    });
  });
}

/**
 * Acknowledges one document (`DOC-003`) — a read-role action, gated per document
 * by {@link canReadDocument}, so any staff member may acknowledge a published
 * `all_staff` document but never a draft or a `managers`-audience one.
 *
 * The body optionally names a `documentVersionId`; when omitted the command
 * resolves the latest published version. A non-UUID id or malformed body is a
 * 400. The document is resolved organization-scoped first — unknown/
 * cross-organization → 404 — and a non-manager without read access is a 403. The
 * actor is the session user. Response: `{ ok: true, acknowledgement }`.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, documentLimiters.acknowledge, async () => {
    const { session } = await requireSession(request);
    const access = await loadDocumentAccess(session.userId);
    if (!isDocumentAuthorized(access, DOCUMENT_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseAcknowledgeBody(await readJsonObject(request));
    if (!parsed.ok) {
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

    let acknowledgement;
    try {
      acknowledgement = await acknowledgeDocument(store, {
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

    const row = toAcknowledgementRow(organizationId, acknowledgement);
    if (row === undefined) {
      return jsonError(404);
    }

    return jsonOk({ acknowledgement: row });
  });
}
