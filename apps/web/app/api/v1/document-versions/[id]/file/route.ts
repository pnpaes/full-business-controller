import {
  createPostgresDocumentsStore,
  createPostgresFileObjectsStore,
  findCurrentPublishedVersion,
  findDocument,
  findDocumentVersion,
  readFileObject,
} from "@aquarela/application";

import { getDb } from "../../../../../../lib/db";
import { getFileStorage } from "../../../../../../lib/file-storage";
import { jsonError, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { getServerSession } from "../../../../../../lib/server-session";

import {
  canManageDocuments,
  canReadDocument,
  DOCUMENT_READ_ROLES,
  isDocumentAuthorized,
  loadDocumentAccess,
} from "../../../documents/access";
import { contentDisposition, isUuid } from "../../../documents/document-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A fresh `ArrayBuffer` so `Response` accepts the bytes whatever backs the array. */
function toResponseBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/**
 * Streams the stored bytes of one document version (`DEC-132`), the download
 * half of the document-library consumer.
 *
 * Authorization mirrors the read gate (`DOC-001`) exactly: a manager may
 * download any version's file; a non-manager may download **only the document's
 * current published `all_staff` version**. A draft, archived or
 * `managers`-audience document is 403 to a non-manager, and a superseded version
 * is 403 even on a readable document. The lookup is organization-scoped
 * (`DEC-061`), so an unknown or cross-organization version is a 404 and cannot
 * leak.
 *
 * Signed out → 401; a role outside `DOCUMENT_READ_ROLES` → 403; a non-UUID id →
 * 400; no file attached to the version → 404. Response: the raw bytes with the
 * stored `Content-Type` and a `Content-Disposition: attachment` filename, and
 * `Cache-Control: private, no-store` (documents are personal/private material,
 * `07:47`).
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
    const db = getDb().db;
    const documentsStore = createPostgresDocumentsStore(db);
    const filesStore = createPostgresFileObjectsStore(db);

    const version = await findDocumentVersion(documentsStore, {
      organizationId,
      documentVersionId: id,
    });
    if (version === undefined) {
      return jsonError(404);
    }

    const document = await findDocument(documentsStore, {
      organizationId,
      documentId: version.documentId,
    });
    if (document === undefined) {
      return jsonError(404);
    }
    if (!canReadDocument(access, document)) {
      return jsonError(403);
    }

    if (!canManageDocuments(access)) {
      const current = await findCurrentPublishedVersion(documentsStore, {
        organizationId,
        documentId: document.id,
      });
      if (current === undefined || current.id !== version.id) {
        return jsonError(403);
      }
    }

    if (version.fileObjectId === null) {
      return jsonError(404);
    }

    const stored = await readFileObject(filesStore, getFileStorage(), {
      organizationId,
      fileObjectId: version.fileObjectId,
    });
    if (stored === undefined) {
      return jsonError(404);
    }

    return new Response(toResponseBody(stored.bytes), {
      status: 200,
      headers: {
        "Content-Type": stored.metadata.mime,
        "Content-Length": String(stored.metadata.sizeBytes),
        "Content-Disposition": contentDisposition(stored.metadata.filename),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  });
}
