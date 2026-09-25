import type { AuditInput } from "../auth";

import type { IntegrationSourceRecord } from "./read-types";

/**
 * Write-side port for the **read-only** integrations registry (`INTG-001`,
 * `DEC-137`). The port is a narrow read-then-write over
 * `@aquarela/persistence`, so the commands can be unit-tested against an
 * in-memory fake. `credentialsOwner` is free text (a named owner per
 * `DEC-015`/I18); `allowedOperations` is an `ALLOWED_OPERATION` subset and a
 * write operation is only legal when `termsStatus` is `approved`.
 */
export interface NewIntegrationSourceRecord {
  readonly organizationId: string;
  readonly name: string;
  readonly systemType: string;
  readonly direction: string;
  readonly allowedOperations: readonly string[];
  readonly credentialsOwner: string;
  readonly rateLimitNote: string | null;
  readonly termsStatus: string;
  readonly active: boolean;
  /** Stamped on `created_by`. */
  readonly actorId: string;
}

export interface UpdateIntegrationSourceRecord {
  readonly organizationId: string;
  readonly integrationSourceId: string;
  readonly name: string;
  readonly systemType: string;
  readonly direction: string;
  readonly allowedOperations: readonly string[];
  readonly credentialsOwner: string;
  readonly rateLimitNote: string | null;
  readonly termsStatus: string;
  readonly active: boolean;
  /** Stamped on `updated_by`. */
  readonly actorId: string;
}

export interface IntegrationSourceWriteStore {
  /**
   * Binds `fn` to one transaction so the write and its audit row commit
   * together (and so the read-then-write duplicate check is consistent).
   */
  withTransaction<T>(fn: (store: IntegrationSourceWriteStore) => Promise<T>): Promise<T>;
  /** The one organization-unique `name` holder, if any. */
  findIntegrationSourceByName(
    organizationId: string,
    name: string,
  ): Promise<IntegrationSourceRecord | undefined>;
  /** One organization-owned source by id, or `undefined` on a scoped miss. */
  findIntegrationSourceById(
    organizationId: string,
    integrationSourceId: string,
  ): Promise<IntegrationSourceRecord | undefined>;
  createIntegrationSource(input: NewIntegrationSourceRecord): Promise<IntegrationSourceRecord>;
  /**
   * Updates one **organization-owned** source; `undefined` when the id is
   * unknown or belongs to another organization (`DEC-061`).
   */
  updateIntegrationSource(
    input: UpdateIntegrationSourceRecord,
  ): Promise<IntegrationSourceRecord | undefined>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
