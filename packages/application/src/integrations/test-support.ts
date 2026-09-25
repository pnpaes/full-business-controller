import type { AuditInput } from "../auth";

import type { IntegrationSourceReadStore, IntegrationSourceRecord } from "./read-types";
import type {
  IntegrationSourceWriteStore,
  NewIntegrationSourceRecord,
  UpdateIntegrationSourceRecord,
} from "./write-types";

/**
 * In-memory store for the integrations unit suite. It mirrors the observable
 * contract (org-scoped lookups, name uniqueness, the update stamp) closely
 * enough to exercise the commands without a database; the postgres adapter is
 * covered by `integrations.postgres.test.ts`. It implements both the read and
 * the write port (`createPostgresIntegrationSourceStore` does the same).
 */
export class FakeIntegrationSourceStore
  implements IntegrationSourceWriteStore, IntegrationSourceReadStore
{
  readonly sources: IntegrationSourceRecord[] = [];
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  async withTransaction<T>(fn: (store: IntegrationSourceWriteStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  listIntegrationSources(query: {
    readonly organizationId: string;
    readonly limit: number;
    readonly offset: number;
  }): Promise<readonly IntegrationSourceRecord[]> {
    const rows = this.sources
      .filter((source) => source.organizationId === query.organizationId)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .slice(query.offset, query.offset + query.limit);
    return Promise.resolve(rows);
  }

  findIntegrationSourceByName(
    organizationId: string,
    name: string,
  ): Promise<IntegrationSourceRecord | undefined> {
    return Promise.resolve(
      this.sources.find(
        (source) => source.organizationId === organizationId && source.name === name,
      ),
    );
  }

  findIntegrationSourceById(
    organizationId: string,
    integrationSourceId: string,
  ): Promise<IntegrationSourceRecord | undefined> {
    return Promise.resolve(
      this.sources.find(
        (source) => source.organizationId === organizationId && source.id === integrationSourceId,
      ),
    );
  }

  createIntegrationSource(input: NewIntegrationSourceRecord): Promise<IntegrationSourceRecord> {
    this.sequence += 1;
    const record: IntegrationSourceRecord = {
      id: `integration-source-${this.sequence}`,
      organizationId: input.organizationId,
      name: input.name,
      systemType: input.systemType,
      direction: input.direction,
      allowedOperations: [...input.allowedOperations],
      credentialsOwner: input.credentialsOwner,
      rateLimitNote: input.rateLimitNote,
      termsStatus: input.termsStatus,
      active: input.active,
      updatedAt: null,
      updatedBy: null,
    };
    this.sources.push(record);
    return Promise.resolve(record);
  }

  updateIntegrationSource(
    input: UpdateIntegrationSourceRecord,
  ): Promise<IntegrationSourceRecord | undefined> {
    const index = this.sources.findIndex(
      (source) =>
        source.id === input.integrationSourceId && source.organizationId === input.organizationId,
    );
    if (index === -1) {
      return Promise.resolve(undefined);
    }
    const updated: IntegrationSourceRecord = {
      id: input.integrationSourceId,
      organizationId: input.organizationId,
      name: input.name,
      systemType: input.systemType,
      direction: input.direction,
      allowedOperations: [...input.allowedOperations],
      credentialsOwner: input.credentialsOwner,
      rateLimitNote: input.rateLimitNote,
      termsStatus: input.termsStatus,
      active: input.active,
      updatedAt: new Date(),
      updatedBy: input.actorId,
    };
    this.sources[index] = updated;
    return Promise.resolve(updated);
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
  }
}
