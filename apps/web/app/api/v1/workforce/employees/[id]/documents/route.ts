import {
  createEmployeeDocument,
  createPostgresWorkforceStore,
  findEmployee,
  listEmployeeDocuments,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";
import { getServerSession } from "../../../../../../../lib/server-session";

import {
  isWorkforceAuthorized,
  loadWorkforceAccess,
  WORKFORCE_EMPLOYEE_DOCUMENT_READ_ROLES,
  WORKFORCE_EMPLOYEE_DOCUMENT_WRITE_ROLES,
} from "../../../access";
import { workforceLimiters } from "../../../limiters";
import {
  isUuid,
  parseCreateEmployeeDocumentBody,
  parseEmployeeDocumentListQuery,
  toEmployeeDocumentRows,
} from "../../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The personnel documents of one employee (`WF-007`, `DEC-087`), ordered by
 * `title` then id.
 *
 * Query: optional `kind` (exact match) plus `limit`/`offset`. Response:
 * `{ ok: true, limit, offset, rows }`. Signed out → 401; a role outside the
 * document read set (owner / general_manager / admin only — `finance` is
 * deliberately excluded, `DEC-099` item 6) → 403; a non-UUID id or a malformed
 * filter → 400.
 *
 * The employee is resolved **organization-scoped** first, so an unknown or
 * cross-organization employee id is a 404 and cannot leak. Document roles are
 * org-wide and `employee_document` has no location column, so **no** location
 * scope is applied here (`DEC-099` item 6).
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
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_DOCUMENT_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseEmployeeDocumentListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresWorkforceStore(getDb().db);

    const employee = await findEmployee(store, { organizationId, employeeId: id });
    if (employee === undefined) {
      return jsonError(404);
    }

    const documents = await listEmployeeDocuments(store, {
      organizationId,
      employeeId: employee.id,
      ...(parsed.query.kind === undefined ? {} : { kind: parsed.query.kind }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toEmployeeDocumentRows(organizationId, documents),
    });
  });
}

/**
 * Creates one personnel document on the employee in the path (`WF-007`,
 * `DEC-087`) — create is limited to owner / general_manager / admin, with
 * `finance` **excluded** (`DEC-099` item 6). The actor is the session user
 * and the employee link is the path id, so the body carries only the metadata:
 * `kind`, `title` and optional `fileObjectId`/`issuedAt`/`expiresAt`.
 *
 * A malformed body (a bad `kind`, a blank `title`, a malformed day) or a
 * non-UUID id is a 400. The path employee is resolved organization-scoped
 * **before** creating, so an unknown or cross-organization employee id is a 404
 * and cannot leak; `fileObjectId` is metadata only — the file-storage port
 * exists (`DEC-132`) but the employee-document consumer is not wired to it.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, workforceLimiters.createEmployeeDocument, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_DOCUMENT_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseCreateEmployeeDocumentBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresWorkforceStore(getDb().db);

    const employee = await findEmployee(store, { organizationId, employeeId: id });
    if (employee === undefined) {
      return jsonError(404);
    }

    let document;
    try {
      document = await createEmployeeDocument(store, {
        organizationId,
        actorId: session.userId,
        employeeId: employee.id,
        kind: parsed.input.kind,
        title: parsed.input.title,
        fileObjectId: parsed.input.fileObjectId,
        issuedAt: parsed.input.issuedAt,
        expiresAt: parsed.input.expiresAt,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ employeeDocumentId: document.id, kind: document.kind });
  });
}
