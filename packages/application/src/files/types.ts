import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for the file-storage slice (`DEC-132`),
 * closing the `file_object` gap recorded by `DEC-085`/`DEC-099`/`ADR-0006`.
 *
 * Two ports compose here. `FileStoragePort` (see `./file-storage`) owns the
 * **bytes** and is deliberately storage-agnostic: the local filesystem adapter
 * is the only implementation today, and a DigitalOcean Spaces (`DEC-014`)
 * adapter is a later implementation behind the same interface. `FileObjectsStore`
 * owns the **metadata row** in `file_object`, which stays the authority for a
 * stored file's key, name, type, size, checksum and retention class.
 *
 * `file_object` carries `organization_id` directly, so every read and write
 * takes the organization and is scoped by it (`DEC-061`). `timestamptz` columns
 * cross the port as ISO strings; `size_bytes` crosses as a number (the column is
 * `bigint` in `number` mode, exact up to 2^53-1 bytes).
 */

/** One `file_object` row (`DEC-085`, `DEC-132`). */
export interface FileObjectRecord {
  readonly id: string;
  readonly organizationId: string;
  /** The storage key the bytes live under; unique per organization. */
  readonly storageKey: string;
  readonly filename: string;
  readonly mime: string;
  /** Byte length; a non-negative integer, never a float. */
  readonly sizeBytes: number;
  /** Lowercase hex SHA-256 of the stored bytes. */
  readonly checksumSha256: string;
  /** Provisional free text, supplied by the consumer (`DEC-132`). */
  readonly retentionPolicy: string;
  /** Plain uuid; the `app_user` FK is deferred, like `created_by`. */
  readonly uploadedBy: string | null;
  /** `timestamptz`, ISO. */
  readonly uploadedAt: string;
  /** Polymorphic target with no FK (the `DEC-095` precedent), or null. */
  readonly linkedEntityType: string | null;
  readonly linkedEntityId: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
}

export interface NewFileObjectRecord {
  readonly organizationId: string;
  readonly storageKey: string;
  readonly filename: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly retentionPolicy: string;
  readonly uploadedBy: string | null;
  readonly linkedEntityType: string | null;
  readonly linkedEntityId: string | null;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/** Filters for the `file_object` metadata list read (`DEC-134`). */
export interface FileObjectListQuery {
  readonly organizationId: string;
  /** Polymorphic link type (`'hms_incident'`, `DEC-095`). */
  readonly linkedEntityType: string;
  /** Polymorphic link id; required with `linkedEntityType`. */
  readonly linkedEntityId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The persistence port for the `file_object` metadata registry. One port covers
 * the metadata table; the bytes are a separate `FileStoragePort`.
 */
export interface FileObjectsStore {
  /**
   * Binds `fn` to one transaction so a metadata create and its audit fact commit
   * or roll back together.
   */
  withTransaction<T>(fn: (store: FileObjectsStore) => Promise<T>): Promise<T>;
  /** Append-only audit fact; never contains file bytes or secrets (ADR-0003). */
  writeAudit(input: AuditInput): Promise<void>;
  createFileObject(input: NewFileObjectRecord): Promise<FileObjectRecord>;
  /** One file object by id, organization-scoped (`DEC-061`), or `undefined`. */
  findFileObject(query: {
    readonly organizationId: string;
    readonly fileObjectId: string;
  }): Promise<FileObjectRecord | undefined>;
  /**
   * The file objects linked to one entity, organization-scoped (`DEC-061`),
   * newest `uploadedAt` first and metadata only — the bytes are never returned
   * here. `listFileObjects` (application) bounds `limit`.
   */
  listFileObjects(query: FileObjectListQuery): Promise<readonly FileObjectRecord[]>;
}
