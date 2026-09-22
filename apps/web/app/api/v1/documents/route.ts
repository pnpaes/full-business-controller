import { createDocument, createPostgresDocumentsStore, listDocuments } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { withMutationGuards } from "../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../lib/http";
import { resolveOrganization } from "../../../../lib/organization";
import { readJsonObject } from "../../../../lib/request";
import { getServerSession } from "../../../../lib/server-session";

import {
  canManageDocuments,
  DOCUMENT_READ_ROLES,
  isDocumentAuthorized,
  loadDocumentAccess,
  DOCUMENT_MANAGE_ROLES,
} from "./access";
import {
  parseCreateDocumentBody,
  parseDocumentListQuery,
  toDocumentRows,
  writePaging,
} from "./document-rows";
import { documentLimiters } from "./limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The staff document library for the served organization (`DEC-088`,
 * `DOC-001`…`DOC-004`).
 *
 * Query: optional `category`/`audience`/`status` (exact match, vocabulary-
 * checked) plus `limit`/`offset`. Response: `{ ok: true, limit, offset, rows }`.
 * Signed out → 401; a role outside the read set → 403 (every role reads,
 * `DOCUMENT_READ_ROLES`); a malformed filter → 400. Never returns another
 * organization's documents (`DEC-061`).
 *
 * The per-document `all_staff` + `published` gate (`DOC-001`): a caller without
 * a manage role may only see published `all_staff` documents. An explicit
 * `status`/`audience` filter other than those values is a 403 (they asked for a
 * slice they may not see); otherwise the two filters are forced into the query,
 * so the page is narrowed server-side rather than filtered in memory. A manager
 * sees everything and the filters are passed through untouched.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadDocumentAccess(session.userId);
    if (!isDocumentAuthorized(access, DOCUMENT_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseDocumentListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    let status = parsed.query.status;
    let audience = parsed.query.audience;
    if (!canManageDocuments(access)) {
      if (
        (status !== undefined && status !== "published") ||
        (audience !== undefined && audience !== "all_staff")
      ) {
        return jsonError(403);
      }
      status = "published";
      audience = "all_staff";
    }

    const organizationId = resolveOrganization();
    const store = createPostgresDocumentsStore(getDb().db);
    const documents = await listDocuments(store, {
      organizationId,
      ...(parsed.query.category === undefined ? {} : { category: parsed.query.category }),
      ...(audience === undefined ? {} : { audience }),
      ...(status === undefined ? {} : { status }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      ...writePaging(parsed.query.limit, parsed.query.offset),
      rows: toDocumentRows(organizationId, documents),
    });
  });
}

/**
 * Creates one document (`DEC-088`) — a managed action, so `DOCUMENT_MANAGE_ROLES`
 * (owner / general_manager / location_manager / admin). The actor is the session
 * user and the organization the served tenant.
 *
 * The body carries `title`, `category`, `audience` and optional `ownerId`. A
 * malformed body — including a `category`/`audience` outside the vocabulary — is
 * a 400 from the parser, as is a `DomainError` from the command.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, documentLimiters.createDocument, async () => {
    const { session } = await requireSession(request);
    const access = await loadDocumentAccess(session.userId);
    if (!isDocumentAuthorized(access, DOCUMENT_MANAGE_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseCreateDocumentBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresDocumentsStore(getDb().db);

    let document;
    try {
      document = await createDocument(store, {
        organizationId,
        actorId: session.userId,
        title: parsed.input.title,
        category: parsed.input.category,
        audience: parsed.input.audience,
        ownerId: parsed.input.ownerId,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ documentId: document.id });
  });
}
