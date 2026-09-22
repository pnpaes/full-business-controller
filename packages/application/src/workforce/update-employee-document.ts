import { DomainError, NotFoundError } from "@aquarela/domain";

import { assertOptionalCalendarDate } from "../hms/register-incident";
import { isBlank } from "../inventory/validation";

import { WORKFORCE_AUDIT_ACTIONS } from "./actions";
import { EMPLOYEE_DOCUMENT_KINDS } from "./create-employee-document";
import type { EmployeeDocumentRecord, WorkforceStore } from "./types";

export interface UpdateEmployeeDocumentInput {
  readonly organizationId: string;
  readonly employeeDocumentId: string;
  /** One of `EMPLOYEE_DOCUMENT_KIND`. Omitted leaves it unchanged. */
  readonly kind?: string;
  /** Non-empty; trimmed. Omitted leaves the title unchanged. */
  readonly title?: string;
  /** Omitted leaves it unchanged; `null` clears it. */
  readonly fileObjectId?: string | null;
  /** `date`, `YYYY-MM-DD`, or null to clear it. */
  readonly issuedAt?: string | null;
  /** `date`, `YYYY-MM-DD`, or null to clear it; must not precede `issuedAt`. */
  readonly expiresAt?: string | null;
  readonly actorId: string;
}

/** Patch field → audit payload key, so `before`/`after` share one shape. */
const AUDIT_FIELDS = {
  kind: "kind",
  title: "title",
  fileObjectId: "file_object_id",
  issuedAt: "issued_at",
  expiresAt: "expires_at",
} as const;

/**
 * Amends one personnel document (`DOC-001`…`DOC-004`, `DEC-087`) — this is the
 * "replace" path for an attached document's metadata; a document is never
 * versioned (`DEC-087` defines no revision model). The row is loaded
 * organization-scoped first (`DEC-061`; a missing or cross-organization id is a
 * typed `NotFoundError`), then the patch is validated: `kind` stays in its
 * vocabulary, `title` stays non-blank and the `issuedAt`/`expiresAt` window stays
 * coherent even when only one of the pair is supplied (the untouched side is the
 * existing value).
 *
 * `employeeId` is immutable after creation, so a document cannot be moved to
 * another employee; an empty patch is rejected. The update and its audit fact
 * commit or roll back together.
 */
export async function updateEmployeeDocument(
  store: WorkforceStore,
  input: UpdateEmployeeDocumentInput,
): Promise<EmployeeDocumentRecord> {
  if (isBlank(input.employeeDocumentId)) {
    throw new DomainError("employeeDocumentId is required");
  }

  return store.withTransaction(async (tx) => {
    const document = await tx.findEmployeeDocument({
      organizationId: input.organizationId,
      employeeDocumentId: input.employeeDocumentId.trim(),
    });
    if (document === undefined) {
      throw new NotFoundError("employee document not found in organization");
    }

    const mutable: {
      kind?: string;
      title?: string;
      fileObjectId?: string | null;
      issuedAt?: string | null;
      expiresAt?: string | null;
    } = {};

    if (input.kind !== undefined) {
      if (isBlank(input.kind)) {
        throw new DomainError("kind is required");
      }
      const kind = input.kind.trim();
      if (!EMPLOYEE_DOCUMENT_KINDS.includes(kind)) {
        throw new DomainError(`kind must be one of ${EMPLOYEE_DOCUMENT_KINDS.join(", ")}`);
      }
      mutable.kind = kind;
    }
    if (input.title !== undefined) {
      if (isBlank(input.title)) {
        throw new DomainError("title is required");
      }
      mutable.title = input.title.trim();
    }
    if (input.fileObjectId !== undefined) {
      mutable.fileObjectId = input.fileObjectId;
    }
    if (input.issuedAt !== undefined) {
      assertOptionalCalendarDate(input.issuedAt, "issuedAt");
      mutable.issuedAt = input.issuedAt;
    }
    if (input.expiresAt !== undefined) {
      assertOptionalCalendarDate(input.expiresAt, "expiresAt");
      mutable.expiresAt = input.expiresAt;
    }

    if (Object.keys(mutable).length === 0) {
      throw new DomainError("no updatable fields provided");
    }

    // Re-check the validity window against the effective values: a patch that
    // moves only one side still has to stay coherent with the other.
    const nextIssuedAt = mutable.issuedAt === undefined ? document.issuedAt : mutable.issuedAt;
    const nextExpiresAt = mutable.expiresAt === undefined ? document.expiresAt : mutable.expiresAt;
    if (nextIssuedAt !== null && nextExpiresAt !== null && nextExpiresAt < nextIssuedAt) {
      throw new DomainError("expiresAt must not precede issuedAt");
    }

    const updated = await tx.updateEmployeeDocument({
      organizationId: input.organizationId,
      employeeDocumentId: document.id,
      ...mutable,
      updatedBy: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("employee document not found in organization");
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of Object.keys(AUDIT_FIELDS) as (keyof typeof AUDIT_FIELDS)[]) {
      if (mutable[field] === undefined) continue;
      before[AUDIT_FIELDS[field]] = document[field];
      after[AUDIT_FIELDS[field]] = updated[field];
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: WORKFORCE_AUDIT_ACTIONS.employeeDocumentUpdated,
      entityType: "employee_document",
      entityId: updated.id,
      before,
      after,
    });

    return updated;
  });
}
