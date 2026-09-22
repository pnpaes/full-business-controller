import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import type { Database } from "../client";
import { employee, employeeDocument } from "../schema";

export type Employee = typeof employee.$inferSelect;
export type EmployeeDocument = typeof employeeDocument.$inferSelect;

/*
 * `DEC-087` (`WF-007`, `DOC-001`…`DOC-004`): the workforce personnel slice.
 *
 * Both tables carry `organization_id` directly, so every read and write that
 * takes the organization is scoped by it (`DEC-061`). A row in another
 * organization is invisible at this scope: reads and updates match on `id`
 * **and** `organization_id`, and a scoped miss returns `undefined` rather than
 * surfacing another tenant's row.
 *
 * `employee` is the parent and is **retired, never deleted** (`03.10`): this
 * layer exposes no delete command, and `retiredAt` records the tombstone
 * (`updateEmployee`). `userId` links the optional login, `costCenterId` stays a
 * plain uuid (the cost-centre FK is a deferred slice) and `roleCode` is free
 * text (the draft has no CHECK). `baseHourlyRate` is a decimal **string** — the
 * repository is decimal-only, never floats. `employeeDocument` records the
 * document metadata; `fileObjectId` is a nullable real FK into `file_object`
 * (the storage path stays deferred, `DEC-085`), and `issuedAt`/`expiresAt` are
 * nullable `date`s crossing this layer as `YYYY-MM-DD` strings.
 *
 * The vocabulary columns (`employment_type`, `kind`), the `base_hourly_rate >= 0`
 * and active-range checks and the cross-organization guards are
 * database-backed, so this layer does not re-validate them; the application
 * validates first so callers see a `DomainError`.
 */

export interface CreateEmployeeInput {
  readonly organizationId: string;
  /** Optional `app_user` login; an employee may exist without one (`WF-001`). */
  readonly userId?: string | null;
  readonly name: string;
  /** Free text: the draft declares no CHECK and no vocabulary for it. */
  readonly roleCode: string;
  /** Checked against the `EMPLOYMENT_TYPE` vocabulary. */
  readonly employmentType: string;
  /** Decimal string (`numeric(19,4)`, money — never a float). */
  readonly baseHourlyRate: string;
  /** Plain uuid; the cost-centre FK is a deferred slice. */
  readonly costCenterId?: string | null;
  /** Nullable FK to `location.id`; guarded same-organization by `0047`. */
  readonly primaryLocationId?: string | null;
  /** `date`; crosses this layer as a `YYYY-MM-DD` string. */
  readonly activeFrom: string;
  /** `date`; a `YYYY-MM-DD` string, or `null`; must be after `activeFrom`. */
  readonly activeTo?: string | null;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/** Creates one employee row. `organizationId` is supplied by the caller. */
export async function createEmployee(db: Database, input: CreateEmployeeInput): Promise<Employee> {
  const rows = await db
    .insert(employee)
    .values({
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      name: input.name,
      roleCode: input.roleCode,
      employmentType: input.employmentType,
      baseHourlyRate: input.baseHourlyRate,
      costCenterId: input.costCenterId ?? null,
      primaryLocationId: input.primaryLocationId ?? null,
      activeFrom: input.activeFrom,
      activeTo: input.activeTo ?? null,
      createdBy: input.actorId ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindEmployeeQuery {
  readonly organizationId: string;
  readonly employeeId: string;
}

/** One employee by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findEmployee(
  db: Database,
  query: FindEmployeeQuery,
): Promise<Employee | undefined> {
  const rows = await db
    .select()
    .from(employee)
    .where(
      and(eq(employee.id, query.employeeId), eq(employee.organizationId, query.organizationId)),
    )
    .limit(1);
  return rows[0];
}

export interface UpdateEmployeePatch {
  readonly name?: string;
  readonly roleCode?: string;
  readonly employmentType?: string;
  /** Decimal string (`numeric(19,4)`), or omitted to leave it untouched. */
  readonly baseHourlyRate?: string;
  readonly costCenterId?: string | null;
  readonly primaryLocationId?: string | null;
  /** `date`; a `YYYY-MM-DD` string, or `null` to clear it. */
  readonly activeTo?: string | null;
  /** Retirement tombstone: set to retire, never to delete (`03.10`). */
  readonly retiredAt?: Date | null;
}

export interface UpdateEmployeeInput extends UpdateEmployeePatch {
  readonly organizationId: string;
  readonly employeeId: string;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/**
 * Updates one employee row's mutable fields, organization-scoped (`DEC-061`).
 * A field left out of the patch is untouched (drizzle skips `undefined`), while
 * an explicit value replaces it and an explicit `null` clears a nullable column;
 * the audit columns record the amendment. `activeFrom` and `userId` are
 * immutable after creation (the frozen API), and the id alone cannot address
 * another tenant's row — a missing or cross-organization id returns
 * `undefined`, exactly like `findEmployee`.
 */
export async function updateEmployee(
  db: Database,
  input: UpdateEmployeeInput,
): Promise<Employee | undefined> {
  const { organizationId, employeeId, actorId, ...patch } = input;
  const rows = await db
    .update(employee)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)))
    .returning();
  return rows[0];
}

export interface ListEmployeesQuery {
  readonly organizationId: string;
  readonly primaryLocationId?: string;
  /** `true` = not retired (`retired_at` null); `false` = retired. */
  readonly active?: boolean;
  /** `true` = retired (`retired_at` set); `false` = not retired. */
  readonly retired?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Employee rows for one organization, ordered by `name` (then `id`), with
 * optional primary-location, active and retired filters. `active` is the
 * not-retired filter and `retired` its complement (employees are retired, never
 * deleted), so a caller uses whichever reads better for the screen. The
 * organization filter is never optional (`DEC-061`); paging is applied after the
 * ordering.
 */
export async function listEmployees(db: Database, query: ListEmployeesQuery): Promise<Employee[]> {
  const statement = db
    .select()
    .from(employee)
    .where(
      and(
        eq(employee.organizationId, query.organizationId),
        query.primaryLocationId === undefined
          ? undefined
          : eq(employee.primaryLocationId, query.primaryLocationId),
        query.active === undefined
          ? undefined
          : query.active
            ? isNull(employee.retiredAt)
            : isNotNull(employee.retiredAt),
        query.retired === undefined
          ? undefined
          : query.retired
            ? isNotNull(employee.retiredAt)
            : isNull(employee.retiredAt),
      ),
    )
    .orderBy(asc(employee.name), asc(employee.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface CreateEmployeeDocumentInput {
  readonly organizationId: string;
  /** NOT NULL: a document must hang off an employee (FK, guarded by `0047`). */
  readonly employeeId: string;
  /** Checked against the `EMPLOYEE_DOCUMENT_KIND` vocabulary. */
  readonly kind: string;
  readonly title: string;
  /** Optional real FK to `file_object.id`; null when no bytes are attached. */
  readonly fileObjectId?: string | null;
  /** `date`; a `YYYY-MM-DD` string, or `null`. */
  readonly issuedAt?: string | null;
  /** `date`; a `YYYY-MM-DD` string, or `null`. */
  readonly expiresAt?: string | null;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/** Creates one personnel-document row. `organizationId` is supplied by the caller. */
export async function createEmployeeDocument(
  db: Database,
  input: CreateEmployeeDocumentInput,
): Promise<EmployeeDocument> {
  const rows = await db
    .insert(employeeDocument)
    .values({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      kind: input.kind,
      title: input.title,
      fileObjectId: input.fileObjectId ?? null,
      issuedAt: input.issuedAt ?? null,
      expiresAt: input.expiresAt ?? null,
      createdBy: input.actorId ?? null,
    })
    .returning();
  return rows[0]!;
}

export interface FindEmployeeDocumentQuery {
  readonly organizationId: string;
  readonly employeeDocumentId: string;
}

/** One personnel document by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findEmployeeDocument(
  db: Database,
  query: FindEmployeeDocumentQuery,
): Promise<EmployeeDocument | undefined> {
  const rows = await db
    .select()
    .from(employeeDocument)
    .where(
      and(
        eq(employeeDocument.id, query.employeeDocumentId),
        eq(employeeDocument.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface UpdateEmployeeDocumentPatch {
  readonly kind?: string;
  readonly title?: string;
  readonly fileObjectId?: string | null;
  /** `date`; a `YYYY-MM-DD` string, or `null` to clear it. */
  readonly issuedAt?: string | null;
  /** `date`; a `YYYY-MM-DD` string, or `null` to clear it. */
  readonly expiresAt?: string | null;
}

export interface UpdateEmployeeDocumentInput extends UpdateEmployeeDocumentPatch {
  readonly organizationId: string;
  readonly employeeDocumentId: string;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/**
 * Updates one personnel document's mutable fields, organization-scoped
 * (`DEC-061`). `employeeId` is immutable after creation, so a document cannot be
 * moved to another employee; a missing or cross-organization id returns
 * `undefined`.
 */
export async function updateEmployeeDocument(
  db: Database,
  input: UpdateEmployeeDocumentInput,
): Promise<EmployeeDocument | undefined> {
  const { organizationId, employeeDocumentId, actorId, ...patch } = input;
  const rows = await db
    .update(employeeDocument)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(
      and(
        eq(employeeDocument.id, employeeDocumentId),
        eq(employeeDocument.organizationId, organizationId),
      ),
    )
    .returning();
  return rows[0];
}

export interface ListEmployeeDocumentsQuery {
  readonly organizationId: string;
  readonly employeeId?: string;
  readonly kind?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Personnel documents for one organization, ordered by `title` (then `id`), with
 * optional employee and kind filters. The organization filter is never optional
 * (`DEC-061`); paging is applied after the ordering.
 */
export async function listEmployeeDocuments(
  db: Database,
  query: ListEmployeeDocumentsQuery,
): Promise<EmployeeDocument[]> {
  const statement = db
    .select()
    .from(employeeDocument)
    .where(
      and(
        eq(employeeDocument.organizationId, query.organizationId),
        query.employeeId === undefined
          ? undefined
          : eq(employeeDocument.employeeId, query.employeeId),
        query.kind === undefined ? undefined : eq(employeeDocument.kind, query.kind),
      ),
    )
    .orderBy(asc(employeeDocument.title), asc(employeeDocument.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
