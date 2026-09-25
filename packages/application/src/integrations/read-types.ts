/**
 * Read-side port for the **read-only** integrations registry (`INTG-001`,
 * `DEC-137`, `ADR-0011`).
 *
 * One projection only: the full registry row the Administration screen shows.
 * There is no write/execution read here — publishing (`INTG-002`, `publish_run`)
 * stays deferred on `ADR-0004`. `updated_at`/`updated_by` cross the port as
 * `Date | null` / `string | null` because both audit columns are nullable until
 * the first update (`auditColumns()`).
 */
export interface IntegrationSourceRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly systemType: string;
  readonly direction: string;
  readonly allowedOperations: readonly string[];
  readonly credentialsOwner: string;
  readonly rateLimitNote: string | null;
  readonly termsStatus: string;
  readonly active: boolean;
  readonly updatedAt: Date | null;
  readonly updatedBy: string | null;
}

export interface ListIntegrationSourcesQuery {
  readonly organizationId: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface IntegrationSourceReadStore {
  /**
   * One bounded page of the organization's integration sources, ordered by
   * `name` (then `id`). `limit`/`offset` are applied by the store so a caller
   * cannot pull the whole registry; the `listIntegrationSources` service
   * validates them against `MAX_INTEGRATION_SOURCE_LIMIT` first.
   */
  listIntegrationSources(query: {
    readonly organizationId: string;
    readonly limit: number;
    readonly offset: number;
  }): Promise<readonly IntegrationSourceRecord[]>;
}
