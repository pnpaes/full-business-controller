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
  /**
   * `DEC-151`: the employee's access level — a role code the organization holds
   * (one of `ROLE_CODE`, an existing `role` row). The family is unchanged from
   * the old free text, so costing/payroll reads keep working.
   */
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
  /** `DEC-151`: the ids of the positions the employee holds (the `many`). */
  readonly positionIds: readonly string[];
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
  /** `DEC-151`: an existing organization role code (validated by the command). */
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
  /** `DEC-151`: the initial position set (deduped by the command). */
  readonly positionIds: readonly string[];
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
  /**
   * `DEC-151`: replaces the whole position set when present (deduped by the
   * command); an empty array clears every position.
   */
  readonly positionIds?: readonly string[];
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

/** The minimal `role` projection the employee role validation needs (`DEC-151`). */
export interface RoleRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
}

/** One `position` row (`DEC-151`): the open, org-scoped employment catalogue. */
export interface PositionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly activeFrom: string;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly activeTo: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  readonly createdBy: string | null;
  /** `timestamptz`, ISO; null before any update. */
  readonly updatedAt?: string | null;
  readonly updatedBy?: string | null;
}

export interface NewPositionRecord {
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly activeFrom: string;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly activeTo: string | null;
  readonly createdBy: string | null;
}

/** The mutable fields of a position; omitted = unchanged, `null` clears. */
export interface PositionPatch {
  readonly code?: string;
  readonly name?: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly activeFrom?: string;
  /** `date`, `YYYY-MM-DD`, or null to reactivate. */
  readonly activeTo?: string | null;
}

export interface UpdatePositionRecord extends PositionPatch {
  readonly organizationId: string;
  readonly positionId: string;
  readonly updatedBy?: string | null;
}

/** Position filters for the store read. */
export interface PositionListQuery {
  readonly organizationId: string;
  /** `true` = active now; `false` = expired. */
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The persistence port for the workforce personnel slice: the parent `employee`
 * entity plus its personnel documents, the fixed `role` lookup the employee role
 * validation needs (`DEC-151`) and the open `position` catalogue. One port covers
 * the tables, mirroring the persistence repository module.
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
  /** The organization's role row for a code, or `undefined` (`DEC-151` validation). */
  findRoleByCode(query: {
    readonly organizationId: string;
    readonly code: string;
  }): Promise<RoleRecord | undefined>;
  createPosition(input: NewPositionRecord): Promise<PositionRecord>;
  /** One position by id, organization-scoped (`DEC-061`), or `undefined`. */
  findPosition(query: {
    readonly organizationId: string;
    readonly positionId: string;
  }): Promise<PositionRecord | undefined>;
  /** One position by code, organization-scoped (`DEC-061`), or `undefined`. */
  findPositionByCode(query: {
    readonly organizationId: string;
    readonly code: string;
  }): Promise<PositionRecord | undefined>;
  /**
   * Applies a patch to one position, organization-scoped (`DEC-061`);
   * `undefined` when no row matches in the organization.
   */
  updatePosition(input: UpdatePositionRecord): Promise<PositionRecord | undefined>;
  listPositions(query: PositionListQuery): Promise<readonly PositionRecord[]>;
  /**
   * Replaces one employee's whole position set (`DEC-151`): deletes the existing
   * grants and inserts `positionIds`, in the caller's transaction.
   */
  setEmployeePositions(input: {
    readonly organizationId: string;
    readonly employeeId: string;
    readonly positionIds: readonly string[];
    readonly actorId: string | null;
  }): Promise<void>;
  /** The positions one employee holds, ordered by name (`DEC-151`). */
  listEmployeePositions(query: {
    readonly organizationId: string;
    readonly employeeId: string;
  }): Promise<readonly PositionRecord[]>;
  /** The position ids of many employees at once, keyed by employee id. */
  listPositionIdsByEmployeeIds(query: {
    readonly organizationId: string;
    readonly employeeIds: readonly string[];
  }): Promise<ReadonlyMap<string, readonly string[]>>;
}
