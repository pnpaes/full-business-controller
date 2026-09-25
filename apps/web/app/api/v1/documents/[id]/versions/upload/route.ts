import {
  createDocumentVersion,
  createPostgresDocumentsStore,
  createPostgresFileObjectsStore,
  findDocument,
  storeFileObject,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { getFileStorage } from "../../../../../../../lib/file-storage";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";

import { DOCUMENT_MANAGE_ROLES, isDocumentAuthorized, loadDocumentAccess } from "../../../access";
import {
  DOCUMENT_FILE_RETENTION_POLICY,
  isUuid,
  parseVersionUploadForm,
} from "../../../document-rows";
import { documentLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Uploads a file and creates the next version of a document from it
 * (`DEC-132`, closing the `DOC-002` file gap that `DEC-085`/`DEC-099` left
 * metadata-only).
 *
 * A managed action (`DOCUMENT_MANAGE_ROLES`: owner / general_manager /
 * location_manager / admin — every set lists `owner`, no implicit bypass). The
 * body is `multipart/form-data` with a required `file` part and an optional
 * `notes` field; the actor is the session user and the retention class is
 * `document_library`. The stored `file_object` is linked to the document
 * (`linked_entity_type = 'document'`) and the new version references it, so a
 * later version-create failure leaves a coherent linked file rather than an
 * orphan (`DEC-132`, ordering and recovery).
 *
 * Signed out → 401 (via `requireSession`); a role outside the manage set → 403;
 * a non-UUID id, a missing/empty file or an over-long note → 400; an unknown,
 * cross-organization or archived document → 404/400. Response:
 * `{ ok: true, documentVersionId, version, fileObjectId, filename, sizeBytes }`.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, documentLimiters.uploadVersionFile, async () => {
    const { session } = await requireSession(request);
    const access = await loadDocumentAccess(session.userId);
    if (!isDocumentAuthorized(access, DOCUMENT_MANAGE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(400);
    }
    const parsed = await parseVersionUploadForm(form);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const db = getDb().db;
    const documentsStore = createPostgresDocumentsStore(db);
    const filesStore = createPostgresFileObjectsStore(db);
    const storage = getFileStorage();

    const document = await findDocument(documentsStore, { organizationId, documentId: id });
    if (document === undefined) {
      return jsonError(404);
    }
    if (document.status === "archived") {
      return jsonError(400, "cannot add a version to an archived document");
    }

    let file;
    try {
      file = await storeFileObject(filesStore, storage, {
        organizationId,
        actorId: session.userId,
        filename: parsed.input.filename,
        mime: parsed.input.mime,
        retentionPolicy: DOCUMENT_FILE_RETENTION_POLICY,
        bytes: parsed.input.bytes,
        linkedEntityType: "document",
        linkedEntityId: document.id,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    let version;
    try {
      version = await createDocumentVersion(documentsStore, {
        organizationId,
        actorId: session.userId,
        documentId: document.id,
        fileObjectId: file.id,
        notes: parsed.input.notes,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({
      documentVersionId: version.id,
      version: version.version,
      fileObjectId: file.id,
      filename: file.filename,
      sizeBytes: file.sizeBytes,
    });
  });
}
