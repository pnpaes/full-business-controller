import {
  createPostgresFileObjectsStore,
  createPostgresWorkforceStore,
  findEmployeeDocument,
  readFileObject,
} from "@aquarela/application";

import { getDb } from "../../../../../../../lib/db";
import { getFileStorage } from "../../../../../../../lib/file-storage";
import { fileAttachmentResponse } from "../../../../../../../lib/file-upload";
import { jsonError, mapErrors } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { getServerSession } from "../../../../../../../lib/server-session";

import {
  isWorkforceAuthorized,
  loadWorkforceAccess,
  WORKFORCE_EMPLOYEE_DOCUMENT_READ_ROLES,
} from "../../../access";
import { isUuid } from "../../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the stored bytes of one personnel document (`DEC-133`), the download
 * half of the employee-document consumer.
 *
 * Gated on the personnel-document read set (owner / general_manager / admin —
 * `finance` is deliberately excluded, `DEC-099` item 6). The document and then
 * the file object are resolved **organization-scoped** (`DEC-061`), so an
 * unknown or cross-organization id is a 404 and cannot leak. A document with no
 * stored file is a 404. Response: the bytes as a private attachment with
 * `nosniff` and `Cache-Control: private, no-store`.
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
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_DOCUMENT_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const db = getDb().db;
    const document = await findEmployeeDocument(createPostgresWorkforceStore(db), {
      organizationId,
      employeeDocumentId: id,
    });
    if (document === undefined || document.fileObjectId === null) {
      return jsonError(404);
    }

    const stored = await readFileObject(createPostgresFileObjectsStore(db), getFileStorage(), {
      organizationId,
      fileObjectId: document.fileObjectId,
    });
    if (stored === undefined) {
      return jsonError(404);
    }

    return fileAttachmentResponse(stored);
  });
}
