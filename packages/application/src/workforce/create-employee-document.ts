import { DomainError, NotFoundError } from "@aquarela/domain";
import { EMPLOYEE_DOCUMENT_KIND } from "@aquarela/persistence";

import { assertOptionalCalendarDate } from "../hms/register-incident";
import { isBlank } from "../inventory/validation";

import { WORKFORCE_AUDIT_ACTIONS } from "./actions";
import type { EmployeeDocumentRecord, WorkforceStore } from "./types";

/** The document-kind vocabulary (`EMPLOYEE_DOCUMENT_KIND`). */
export const EMPLOYEE_DOCUMENT_KINDS: readonly string[] = EMPLOYEE_DOCUMENT_KIND;

export interface CreateEmployeeDocumentInput {
  readonly organizationId: string;
  readonly employeeId: string;
  /** One of `EMPLOYEE_DOCUMENT_KIND` (contract/certificate/id_document/other). */
  readonly kind: string;
  readonly title: string;
  /** Optional real FK to `file_object.id`; null when no bytes are attached. */
  readonly fileObjectId?: string | null;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly issuedAt?: string | null;
  /** `date`, `YYYY-MM-DD`, or null; must not precede `issuedAt` when both set. */
  readonly expiresAt?: string | null;
  readonly actorId: string;
}

/**
 * Creates one personnel document (`DOC-001`…`DOC-004`, `DEC-087`): validates the
 * `kind` vocabulary, the non-blank `title` and the optional `issuedAt`/`expiresAt`
 * validity window (`expiresAt` must not precede `issuedAt`), then creates the
 * metadata row and its audit fact in one transaction. The create is
 * organization-scoped through `input.organizationId` (`DEC-061`).
 *
 * The employee is resolved **organization-scoped first** (missing or
 * cross-organization → typed `NotFoundError`) so an unregistered or foreign
 * employee id cannot leak: the `employee_document.employee_id` FK alone would
 * accept a cross-organization row, and the `0047` guard trigger only fires after
 * the insert.
 *
 * `fileObjectId` is a nullable real FK to `file_object`, but the storage/upload
 * path stays deferred (`DEC-085`), so only the metadata row is created and no
 * bytes are touched. There is **no revision model** (`DEC-087` defines none):
 * do not invent `supersedes_id` or a version column.
 */
export async function createEmployeeDocument(
  store: WorkforceStore,
  input: CreateEmployeeDocumentInput,
): Promise<EmployeeDocumentRecord> {
  if (isBlank(input.employeeId)) {
    throw new DomainError("employeeId is required");
  }
  if (isBlank(input.kind)) {
    throw new DomainError("kind is required");
  }
  const kind = input.kind.trim();
  if (!EMPLOYEE_DOCUMENT_KINDS.includes(kind)) {
    throw new DomainError(`kind must be one of ${EMPLOYEE_DOCUMENT_KINDS.join(", ")}`);
  }
  if (isBlank(input.title)) {
    throw new DomainError("title is required");
  }
  assertOptionalCalendarDate(input.issuedAt, "issuedAt");
  assertOptionalCalendarDate(input.expiresAt, "expiresAt");
  if (
    input.issuedAt !== undefined &&
    input.issuedAt !== null &&
    input.expiresAt !== undefined &&
    input.expiresAt !== null &&
    input.expiresAt < input.issuedAt
  ) {
    throw new DomainError("expiresAt must not precede issuedAt");
  }

  return store.withTransaction(async (tx) => {
    const employee = await tx.findEmployee({
      organizationId: input.organizationId,
      employeeId: input.employeeId.trim(),
    });
    if (employee === undefined) {
      throw new NotFoundError("employee not found in organization");
    }

    const document = await tx.createEmployeeDocument({
      organizationId: input.organizationId,
      employeeId: employee.id,
      kind,
      title: input.title.trim(),
      fileObjectId: input.fileObjectId ?? null,
      issuedAt: input.issuedAt ?? null,
      expiresAt: input.expiresAt ?? null,
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: WORKFORCE_AUDIT_ACTIONS.employeeDocumentCreated,
      entityType: "employee_document",
      entityId: document.id,
      after: {
        employee_id: document.employeeId,
        kind: document.kind,
        title: document.title,
        file_object_id: document.fileObjectId,
        issued_at: document.issuedAt,
        expires_at: document.expiresAt,
      },
    });

    return document;
  });
}
