import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for the workforce personnel slice (`DEC-087`,
 * `WF-007`, `DOC-001`…`DOC-004`).
 *
 * Both tables (`employee`, `employee_document`) carry `organization_id`
 * directly, so every read and write takes the organization and is scoped by it
 * (`DEC-061`). `timestamptz` columns (`retiredAt`, `createdAt`) cross the port as
 * ISO strings, the `date` columns (`activeFrom`, `activeTo`, `issuedAt`,
 * `expiresAt`) as `YYYY-MM-DD` strings, and `baseHourlyRate` as a decimal string
 * at money scale (`numeric(19,4)` — decimal only, never floats).
 *
 * This is a **different domain from HMS**, so it has its own `WorkforceStore`
 * port rather than extending `HmsStore`; there is deliberately **no second store
 * for documents** — one port covers both tables, like the repository module.
 */

/** One `employee` row (`DEC-087`, `WF-007`). */
export interface EmployeeRecord {
  readonly id: string;
  readonly organizationId: string;
  /** Optional `app_user` login; an employee may exist without one (`WF-001`). */
  readonly userId: string | null;
  readonly name: string;
  /** Free text: the draft declares no CHECK and no vocabulary for it. */
  readonly roleCode: string;
  /** One of `EMPLOYMENT_TYPE`. */
  readonly employmentType: string;
  /** Decimal string (`numeric(19,4)`, money — never a float). */
  readonly baseHourlyRate: string;
  /** Plain uuid; the cost-centre FK is a deferred slice. */
  readonly costCenterId: string | null;
  readonly primaryLocationId: string | null;
  /** `date`, `YYYY-MM-DD`. */
  readonly activeFrom: string;
  /** `date`, `YYYY-MM-DD`, or null; strictly after `activeFrom` when set. */
  readonly activeTo: string | null;
  /** `timestamptz`, ISO; the retirement tombstone (retired, never deleted). */
  readonly retiredAt: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  readonly createdBy: string | null;
  /** The actor of the last amendment, or null before any update. */
  readonly updatedBy?: string | null;
}

export interface NewEmployeeRecord {
  readonly organizationId: string;
  readonly userId: string | null;
  readonly name: string;
  /** Free text. */
  readonly roleCode: string;
  /** One of `EMPLOYMENT_TYPE`. */
  readonly employmentType: string;
  /** Decimal string (`numeric(19,4)`). */
  readonly baseHourlyRate: string;
  readonly costCenterId: string | null;
  readonly primaryLocationId: string | null;
  /** `date`, `YYYY-MM-DD`. */
  readonly activeFrom: string;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly activeTo: string | null;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/**
 * The mutable fields of an employee. `activeFrom` and `userId` are immutable
 * after creation (the frozen API), and `retiredAt` is set only by the
 * `retireEmployee` command. `undefined` means "leave as is"; `null` clears an
 * optional field.
 */
export interface EmployeePatch {
  readonly name?: string;
  readonly roleCode?: string;
  readonly employmentType?: string;
  /** Decimal string (`numeric(19,4)`). */
  readonly baseHourlyRate?: string;
  readonly costCenterId?: string | null;
  readonly primaryLocationId?: string | null;
  /** `date`, `YYYY-MM-DD`, or null to clear it. */
  readonly activeTo?: string | null;
  /** `timestamptz`, ISO: the retirement tombstone (never deleted). */
  readonly retiredAt?: string | null;
}

/** An organization-scoped patch of one employee by id (`DEC-061`). */
export interface UpdateEmployeeRecord extends EmployeePatch {
  readonly organizationId: string;
  readonly employeeId: string;
  /** The acting actor; recorded as `updated_by`. */
  readonly updatedBy?: string | null;
}

/** Employee filters for the store read. */
export interface EmployeeListQuery {
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
 * One `employee_document` row (`DEC-087`, `DOC-001`…`DOC-004`). `fileObjectId`
 * is a nullable real FK to `file_object`; the storage/upload path stays deferred
 * (`DEC-085`), so the row records metadata only. `issuedAt`/`expiresAt` are the
 * certificate validity window. There is **no revision model** (`DEC-087` defines
 * none): no version column and no `supersedes_id`.
 */
export interface EmployeeDocumentRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly employeeId: string;
  /** One of `EMPLOYEE_DOCUMENT_KIND`. */
  readonly kind: string;
  readonly title: string;
  readonly fileObjectId: string | null;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly issuedAt: string | null;
  /** `date`, `YYYY-MM-DD`, or null; must not precede `issuedAt` when set. */
  readonly expiresAt: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  readonly createdBy: string | null;
  /** The actor of the last amendment, or null before any update. */
  readonly updatedBy?: string | null;
}

export interface NewEmployeeDocumentRecord {
  readonly organizationId: string;
  readonly employeeId: string;
  /** One of `EMPLOYEE_DOCUMENT_KIND`. */
  readonly kind: string;
  readonly title: string;
  readonly fileObjectId: string | null;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly issuedAt: string | null;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly expiresAt: string | null;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/** One `employee_document` patch. Omitted field = unchanged; `null` clears it. */
export interface EmployeeDocumentPatch {
  readonly kind?: string;
  readonly title?: string;
  readonly fileObjectId?: string | null;
  /** `date`, `YYYY-MM-DD`, or null to clear it. */
  readonly issuedAt?: string | null;
  /** `date`, `YYYY-MM-DD`, or null to clear it. */
  readonly expiresAt?: string | null;
}

/** An organization-scoped patch of one document by id (`DEC-061`). */
export interface UpdateEmployeeDocumentRecord extends EmployeeDocumentPatch {
  readonly organizationId: string;
  readonly employeeDocumentId: string;
  /** The acting actor; recorded as `updated_by`. */
  readonly updatedBy?: string | null;
}

/** Document filters for the store read. */
export interface EmployeeDocumentListQuery {
  readonly organizationId: string;
  readonly employeeId?: string;
  /** One of `EMPLOYEE_DOCUMENT_KIND`, exact match. */
  readonly kind?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The persistence port for the workforce personnel slice: the parent `employee`
 * entity plus its personnel documents. One port covers both tables (there is no
 * separate document store), mirroring the persistence repository module.
 */
export interface WorkforceStore {
  /**
   * Binds `fn` to one transaction so a create and its audit fact commit or roll
   * back together.
   */
  withTransaction<T>(fn: (store: WorkforceStore) => Promise<T>): Promise<T>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
  createEmployee(input: NewEmployeeRecord): Promise<EmployeeRecord>;
  /** One employee by id, organization-scoped (`DEC-061`), or `undefined`. */
  findEmployee(query: {
    readonly organizationId: string;
    readonly employeeId: string;
  }): Promise<EmployeeRecord | undefined>;
  /**
   * Applies a patch to one employee, organization-scoped (`DEC-061`);
   * `undefined` when no row matches in the organization.
   */
  updateEmployee(input: UpdateEmployeeRecord): Promise<EmployeeRecord | undefined>;
  listEmployees(query: EmployeeListQuery): Promise<readonly EmployeeRecord[]>;
  createEmployeeDocument(input: NewEmployeeDocumentRecord): Promise<EmployeeDocumentRecord>;
  /** One document by id, organization-scoped (`DEC-061`), or `undefined`. */
  findEmployeeDocument(query: {
    readonly organizationId: string;
    readonly employeeDocumentId: string;
  }): Promise<EmployeeDocumentRecord | undefined>;
  /**
   * Applies a patch to one document, organization-scoped (`DEC-061`);
   * `undefined` when no row matches in the organization. `employeeId` is
   * immutable after creation.
   */
  updateEmployeeDocument(
    input: UpdateEmployeeDocumentRecord,
  ): Promise<EmployeeDocumentRecord | undefined>;
  listEmployeeDocuments(
    query: EmployeeDocumentListQuery,
  ): Promise<readonly EmployeeDocumentRecord[]>;
}
