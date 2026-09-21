import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for slice 11 — the **import framework +
 * external mappings** (`SALE-002`, `SALE-004`, `SALE-007`, `SALE-008`;
 * `DEC-025`, `DEC-033`, `DEC-035`, `DEC-041`).
 *
 * This slice registers an upload, stages its rows, validates them, maps them to
 * internal entities and records dispositions. It **never posts**: posting,
 * sales, settlements and reconciliation are slice 12 (`SALE-003`/`SALE-005`),
 * owner-gated on `ADR-0008`, so a run stops at `validated`/`needs_review`.
 *
 * `timestamptz` columns are carried as ISO strings, as in the slice-9/10 ports.
 * `rowCounts` and `diagnostics` are jsonb and deliberately loose: no authority
 * pins their shape yet, so this slice owns the keys it writes (see each
 * command) and never interprets keys it did not write.
 */

export interface ImportRunRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly source: string;
  /**
   * The run's resolved import-profile id (`DEC-081`), or `null` for a legacy run
   * or a source with no profile. Resolved from the run's source when it is
   * created; the run's policy/version come from whatever that profile is.
   */
  readonly importProfileId: string | null;
  /**
   * The import profile's version label (`DEC-081`). Normally the version of the
   * resolved profile; for a run with no profile it is the caller-supplied label.
   */
  readonly profileVersion: string;
  /**
   * Plain uuid (recorded open point): the platform `file` table does not exist
   * yet, so `file_object_id` is not a foreign key and this slice never reads it.
   */
  readonly fileObjectId: string | null;
  readonly fileHash: string;
  /** `date` (`yyyy-mm-dd`), the business period the file covers. */
  readonly periodStart: string;
  /** `date` (`yyyy-mm-dd`). */
  readonly periodEnd: string;
  readonly status: string;
  /** jsonb; keys written by this slice: `staged`, `valid`, `error`, `mapped`, … */
  readonly rowCounts: Readonly<Record<string, number>>;
  /** jsonb; keys written by this slice: `posting_policy`, `issues`, `conflicts`, … */
  readonly diagnostics: Readonly<Record<string, unknown>>;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export interface NewImportRunRecord {
  readonly organizationId: string;
  readonly source: string;
  /** The resolved profile id (`DEC-081`), or `null` when the source has none. */
  readonly importProfileId: string | null;
  readonly profileVersion: string;
  readonly fileObjectId: string | null;
  readonly fileHash: string;
  /** `date` (`yyyy-mm-dd`). */
  readonly periodStart: string;
  /** `date` (`yyyy-mm-dd`). */
  readonly periodEnd: string;
  readonly status: string;
  readonly rowCounts: Readonly<Record<string, number>>;
  readonly diagnostics: Readonly<Record<string, unknown>>;
  readonly createdBy: string | null;
}

/**
 * An `import_profile` row (`DEC-081`): the per-source posting policy and
 * validation config, keyed `(organization_id, source)`. `validationRules` is
 * jsonb narrowed to an object; parse it with `parseImportValidationRules`.
 */
export interface ImportProfileRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly source: string;
  readonly profileVersion: string;
  readonly postingPolicy: string;
  readonly validationRules: Readonly<Record<string, unknown>>;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export interface NewImportProfileRecord {
  readonly organizationId: string;
  readonly source: string;
  readonly profileVersion: string;
  readonly postingPolicy: string;
  readonly validationRules: Readonly<Record<string, unknown>>;
  readonly createdBy: string | null;
}

/**
 * Exactly one of `importProfileId`/`source` identifies the profile, so supplying
 * both (or neither) is a compile error (mirrors the repository).
 */
export type FindImportProfileQuery =
  | {
      readonly organizationId: string;
      readonly importProfileId: string;
      readonly source?: undefined;
    }
  | {
      readonly organizationId: string;
      readonly source: string;
      readonly importProfileId?: undefined;
    };

export interface UpdateImportRunValues {
  readonly status?: string;
  readonly rowCounts?: Readonly<Record<string, number>>;
  readonly diagnostics?: Readonly<Record<string, unknown>>;
}

export interface ImportStagingRowRecord {
  readonly id: string;
  readonly importRunId: string;
  readonly sourceRowNo: number;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly normalized: Readonly<Record<string, unknown>>;
  readonly mappingState: string;
  readonly errorCode: string | null;
  /** Slice 12 owns the link to a posted `sales_line`; always null in slice 11. */
  readonly linkedSalesLineId: string | null;
}

export interface NewImportStagingRowRecord {
  readonly importRunId: string;
  readonly sourceRowNo: number;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly normalized: Readonly<Record<string, unknown>>;
  readonly mappingState: string;
  readonly errorCode: string | null;
  readonly linkedSalesLineId: string | null;
}

export interface UpdateImportStagingRowValues {
  readonly normalized?: Readonly<Record<string, unknown>>;
  readonly mappingState?: string;
  readonly errorCode?: string | null;
  readonly linkedSalesLineId?: string | null;
}

/**
 * An `external_mapping` row (`SALE-002`). `sku` is the preferred match key
 * (`DEC-041`); the effective window is carried but this slice reads the rows
 * the caller scopes and does not invent as-of filtering beyond what the
 * repository returns.
 */
export interface ExternalMappingRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly sourceSystem: string;
  readonly entityType: string;
  readonly externalId: string;
  readonly sku: string | null;
  readonly internalEntityType: string;
  readonly internalEntityId: string;
  /** `timestamptz`, ISO. */
  readonly effectiveFrom: string;
  /** `timestamptz`, ISO; null while open. */
  readonly effectiveTo: string | null;
}

export interface FindImportRunQuery {
  readonly organizationId: string;
  /**
   * Exactly one of `importRunId` / `fileHash` identifies the run. There is no
   * repository lookup by hash, so the Postgres adapter matches the hash over
   * the organization's runs; the `import_run_file_hash_key` unique index is the
   * real replay guard (recorded open point).
   */
  readonly importRunId?: string;
  readonly fileHash?: string;
}

export interface ListImportRunsQuery {
  readonly organizationId: string;
  readonly status?: string;
  readonly source?: string;
  /** Defaults to 50; the API caps it at 200. */
  readonly limit?: number;
  readonly offset?: number;
}

export interface ListExternalMappingsQuery {
  readonly organizationId: string;
  readonly sourceSystem?: string;
  readonly entityType?: string;
}

export interface ImportStore {
  /** Binds `fn` to one transaction so the run, its rows and the audit fact commit together. */
  withTransaction<T>(fn: (store: ImportStore) => Promise<T>): Promise<T>;
  /** One run by id or file hash, organization-scoped (`DEC-061`), or `undefined`. */
  findImportRun(query: FindImportRunQuery): Promise<ImportRunRecord | undefined>;
  listImportRuns(query: ListImportRunsQuery): Promise<readonly ImportRunRecord[]>;
  createImportRun(input: NewImportRunRecord): Promise<ImportRunRecord>;
  updateImportRun(id: string, values: UpdateImportRunValues): Promise<ImportRunRecord>;
  /** One profile by id or source, organization-scoped (`DEC-061`), or `undefined`. */
  findImportProfile(query: FindImportProfileQuery): Promise<ImportProfileRecord | undefined>;
  /** Creates the per-source profile (`DEC-081`); `(organization_id, source)` is unique. */
  createImportProfile(input: NewImportProfileRecord): Promise<ImportProfileRecord>;
  /** One staging row by id, organization-scoped through its parent run. */
  findImportStagingRow(query: {
    readonly organizationId: string;
    readonly importRunId: string;
    readonly stagingRowId: string;
  }): Promise<ImportStagingRowRecord | undefined>;
  /** Staging rows of one run, ordered by `source_row_no`. */
  listImportStagingRows(query: {
    readonly organizationId: string;
    readonly importRunId: string;
  }): Promise<readonly ImportStagingRowRecord[]>;
  createImportStagingRow(input: NewImportStagingRowRecord): Promise<ImportStagingRowRecord>;
  updateImportStagingRow(
    id: string,
    values: UpdateImportStagingRowValues,
  ): Promise<ImportStagingRowRecord>;
  listExternalMappings(query: ListExternalMappingsQuery): Promise<readonly ExternalMappingRecord[]>;
  /**
   * The internal entity for a platform-owned SKU (`DEC-041`), organization- and
   * entity-type-scoped, or `undefined`. The persistence layer exposes an item
   * lookup today; other entity types resolve to `undefined` until a repository
   * lookup exists (recorded open point).
   */
  findEntityBySku(query: {
    readonly organizationId: string;
    readonly entityType: string;
    readonly sku: string;
  }): Promise<{ readonly internalEntityId: string } | undefined>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
