import {
  createPostgresWorkforceStore,
  findEmployeeDocument,
  updateEmployeeDocument,
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
  isWorkforceAuthorized,
  loadWorkforceAccess,
  WORKFORCE_EMPLOYEE_DOCUMENT_READ_ROLES,
  WORKFORCE_EMPLOYEE_DOCUMENT_WRITE_ROLES,
} from "../../access";
import { workforceLimiters } from "../../limiters";
import {
  isUuid,
  parseUpdateEmployeeDocumentBody,
  toEmployeeDocumentRow,
} from "../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One personnel document by id (`WF-007`, `DEC-087`).
 *
 * Signed out → 401; a role outside the document read set (owner /
 * general_manager / admin only — `finance` is deliberately excluded, `DEC-099`
 * item 6) → 403; a non-UUID id → 400. The read is organization-scoped, so an
 * unknown or cross-organization id is a 404 (`DEC-061`). Document roles are
 * org-wide and the table has no location column, so **no** location scope is
 * applied (`DEC-099` item 6).
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
    const store = createPostgresWorkforceStore(getDb().db);
    const document = await findEmployeeDocument(store, {
      organizationId,
      employeeDocumentId: id,
    });
    if (document === undefined) {
      return jsonError(404);
    }

    return jsonOk({ document: toEmployeeDocumentRow(organizationId, document) });
  });
}

/**
 * Replaces/amends one personnel document's metadata (`WF-007`, `DEC-087`) —
 * the "replace" path for an attached document, limited to owner /
 * general_manager / admin with `finance` **excluded** (`DEC-099` item 6). There
 * is no revision model (`DEC-087` defines none): the row is amended in place and
 * the audit fact carries the before/after provenance.
 *
 * The body is any subset of `kind`, `title`, `fileObjectId`, `issuedAt` and
 * `expiresAt` (`null` clears an optional field); `employeeId` is immutable. A
 * malformed body or a non-UUID id is a 400, as is a command rejection (a bad
 * `kind`, an empty title, an incoherent validity window, no fields). An
 * unknown/cross-organization document is a 404. No location scope is applied
 * (`DEC-099` item 6).
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, workforceLimiters.updateEmployeeDocument, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_DOCUMENT_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseUpdateEmployeeDocumentBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresWorkforceStore(getDb().db);

    let document;
    try {
      document = await updateEmployeeDocument(store, {
        organizationId,
        actorId: session.userId,
        employeeDocumentId: id,
        ...parsed.input,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ document: toEmployeeDocumentRow(organizationId, document) });
  });
}
