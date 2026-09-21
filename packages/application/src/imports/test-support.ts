import type { AuditInput } from "../auth";

import type {
  ExternalMappingRecord,
  FindImportProfileQuery,
  FindImportRunQuery,
  ImportDispositionCount,
  ImportDispositionRecord,
  ImportProfileRecord,
  ImportRunRecord,
  ImportStagingRowRecord,
  ImportStore,
  ListExternalMappingsQuery,
  ListImportRunsQuery,
  NewImportDispositionRecord,
  NewImportProfileRecord,
  NewImportRunRecord,
  NewImportStagingRowRecord,
  UpdateImportRunValues,
  UpdateImportStagingRowValues,
} from "./types";

function skuKey(organizationId: string, entityType: string, sku: string): string {
  return `${organizationId}\u0000${entityType}\u0000${sku}`;
}

/**
 * In-memory `ImportStore` for the unit suite. It mirrors the Postgres adapter's
 * organization scoping and ordering so the commands can be exercised without a
 * database; `imports.postgres.test.ts` covers the real adapter under
 * `DATABASE_URL`.
 */
export class FakeImportStore implements ImportStore {
  readonly importRuns = new Map<string, ImportRunRecord>();
  readonly importProfiles = new Map<string, ImportProfileRecord>();
  readonly stagingRows = new Map<string, ImportStagingRowRecord>();
  readonly importDispositions = new Map<string, ImportDispositionRecord>();
  readonly externalMappings = new Map<string, ExternalMappingRecord>();
  readonly internalEntitiesBySku = new Map<string, { readonly internalEntityId: string }>();
  readonly auditEvents: AuditInput[] = [];

  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async withTransaction<T>(fn: (store: ImportStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async findImportRun(query: FindImportRunQuery): Promise<ImportRunRecord | undefined> {
    const run =
      query.importRunId !== undefined
        ? this.importRuns.get(query.importRunId)
        : [...this.importRuns.values()].find((candidate) => candidate.fileHash === query.fileHash);
    if (run === undefined || run.organizationId !== query.organizationId) {
      return undefined;
    }
    return run;
  }

  async listImportRuns(query: ListImportRunsQuery): Promise<readonly ImportRunRecord[]> {
    const rows = [...this.importRuns.values()]
      .filter((run) => run.organizationId === query.organizationId)
      .filter((run) => query.status === undefined || run.status === query.status)
      .filter((run) => query.source === undefined || run.source === query.source)
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return a.createdAt < b.createdAt ? 1 : -1;
        }
        return a.id < b.id ? 1 : -1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async createImportRun(input: NewImportRunRecord): Promise<ImportRunRecord> {
    const record: ImportRunRecord = {
      id: this.nextId("import-run"),
      organizationId: input.organizationId,
      source: input.source,
      importProfileId: input.importProfileId,
      profileVersion: input.profileVersion,
      fileObjectId: input.fileObjectId,
      fileHash: input.fileHash,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: input.status,
      rowCounts: input.rowCounts,
      diagnostics: input.diagnostics,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
    };
    this.importRuns.set(record.id, record);
    return record;
  }

  async findImportProfile(query: FindImportProfileQuery): Promise<ImportProfileRecord | undefined> {
    const profile =
      query.importProfileId !== undefined
        ? this.importProfiles.get(query.importProfileId)
        : [...this.importProfiles.values()].find((candidate) => candidate.source === query.source);
    if (profile === undefined || profile.organizationId !== query.organizationId) {
      return undefined;
    }
    return profile;
  }

  async createImportProfile(input: NewImportProfileRecord): Promise<ImportProfileRecord> {
    const source = input.source.trim();
    const profileVersion = input.profileVersion.trim();
    const duplicate = [...this.importProfiles.values()].find(
      (candidate) =>
        candidate.organizationId === input.organizationId && candidate.source === source,
    );
    if (duplicate !== undefined) {
      throw new Error(
        `import_profile already exists for source ${source} in organization ${input.organizationId}`,
      );
    }
    const record: ImportProfileRecord = {
      id: this.nextId("import-profile"),
      organizationId: input.organizationId,
      source,
      profileVersion,
      postingPolicy: input.postingPolicy,
      validationRules: input.validationRules,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
    };
    this.importProfiles.set(record.id, record);
    return record;
  }

  async updateImportRun(id: string, values: UpdateImportRunValues): Promise<ImportRunRecord> {
    const existing = this.importRuns.get(id);
    if (existing === undefined) {
      throw new Error("import_run not found for update");
    }
    const record: ImportRunRecord = {
      ...existing,
      ...(values.status === undefined ? {} : { status: values.status }),
      ...(values.rowCounts === undefined ? {} : { rowCounts: values.rowCounts }),
      ...(values.diagnostics === undefined ? {} : { diagnostics: values.diagnostics }),
    };
    this.importRuns.set(id, record);
    return record;
  }

  async findImportStagingRow(query: {
    readonly organizationId: string;
    readonly importRunId: string;
    readonly stagingRowId: string;
  }): Promise<ImportStagingRowRecord | undefined> {
    const run = this.importRuns.get(query.importRunId);
    if (run === undefined || run.organizationId !== query.organizationId) {
      return undefined;
    }
    const row = this.stagingRows.get(query.stagingRowId);
    return row !== undefined && row.importRunId === query.importRunId ? row : undefined;
  }

  async listImportStagingRows(query: {
    readonly organizationId: string;
    readonly importRunId: string;
  }): Promise<readonly ImportStagingRowRecord[]> {
    const run = this.importRuns.get(query.importRunId);
    if (run === undefined || run.organizationId !== query.organizationId) {
      return [];
    }
    return [...this.stagingRows.values()]
      .filter((row) => row.importRunId === query.importRunId)
      .sort((a, b) => a.sourceRowNo - b.sourceRowNo);
  }

  async createImportStagingRow(input: NewImportStagingRowRecord): Promise<ImportStagingRowRecord> {
    const record: ImportStagingRowRecord = { id: this.nextId("staging-row"), ...input };
    this.stagingRows.set(record.id, record);
    return record;
  }

  async updateImportStagingRow(
    id: string,
    values: UpdateImportStagingRowValues,
  ): Promise<ImportStagingRowRecord> {
    const existing = this.stagingRows.get(id);
    if (existing === undefined) {
      throw new Error("import_staging_row not found for update");
    }
    const record: ImportStagingRowRecord = {
      ...existing,
      ...(values.normalized === undefined ? {} : { normalized: values.normalized }),
      ...(values.mappingState === undefined ? {} : { mappingState: values.mappingState }),
      ...(values.errorCode === undefined ? {} : { errorCode: values.errorCode }),
      ...(values.linkedSalesLineId === undefined
        ? {}
        : { linkedSalesLineId: values.linkedSalesLineId }),
    };
    this.stagingRows.set(id, record);
    return record;
  }

  async createImportDisposition(input: NewImportDispositionRecord): Promise<boolean> {
    if (this.importDispositions.has(input.stagingRowId)) {
      return false;
    }
    const stagingRow = this.stagingRows.get(input.stagingRowId);
    if (stagingRow === undefined) {
      throw new Error(`staging row ${input.stagingRowId} not found for disposition`);
    }
    const record: ImportDispositionRecord = {
      stagingRowId: input.stagingRowId,
      sourceRowNo: stagingRow.sourceRowNo,
      disposition: input.disposition,
      reason: input.reason,
      actorId: input.actorId,
      at: new Date().toISOString(),
    };
    this.importDispositions.set(record.stagingRowId, record);
    return true;
  }

  async listImportDispositions(query: {
    readonly organizationId: string;
    readonly importRunId: string;
  }): Promise<readonly ImportDispositionRecord[]> {
    const run = this.importRuns.get(query.importRunId);
    if (run === undefined || run.organizationId !== query.organizationId) {
      return [];
    }
    return [...this.importDispositions.values()]
      .filter(
        (disposition) =>
          this.stagingRows.get(disposition.stagingRowId)?.importRunId === query.importRunId,
      )
      .sort((a, b) => a.sourceRowNo - b.sourceRowNo);
  }

  async countImportDispositionsByRun(query: {
    readonly organizationId: string;
    readonly importRunIds: readonly string[];
  }): Promise<readonly ImportDispositionCount[]> {
    if (query.importRunIds.length === 0) {
      return [];
    }
    const counts = new Map<string, number>();
    for (const disposition of this.importDispositions.values()) {
      const stagingRow = this.stagingRows.get(disposition.stagingRowId);
      if (stagingRow === undefined || !query.importRunIds.includes(stagingRow.importRunId)) {
        continue;
      }
      const run = this.importRuns.get(stagingRow.importRunId);
      if (run === undefined || run.organizationId !== query.organizationId) {
        continue;
      }
      counts.set(stagingRow.importRunId, (counts.get(stagingRow.importRunId) ?? 0) + 1);
    }
    return [...counts.entries()].map(([importRunId, count]) => ({ importRunId, count }));
  }

  async listExternalMappings(
    query: ListExternalMappingsQuery,
  ): Promise<readonly ExternalMappingRecord[]> {
    return [...this.externalMappings.values()]
      .filter((mapping) => mapping.organizationId === query.organizationId)
      .filter(
        (mapping) =>
          query.sourceSystem === undefined || mapping.sourceSystem === query.sourceSystem,
      )
      .filter(
        (mapping) => query.entityType === undefined || mapping.entityType === query.entityType,
      );
  }

  async findEntityBySku(query: {
    readonly organizationId: string;
    readonly entityType: string;
    readonly sku: string;
  }): Promise<{ readonly internalEntityId: string } | undefined> {
    return this.internalEntitiesBySku.get(
      skuKey(query.organizationId, query.entityType, query.sku),
    );
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.auditEvents.push(input);
  }
}

export interface ImportFixture {
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly actorId: string;
  readonly source: string;
  readonly sourceSystem: string;
  readonly itemSku: string;
  readonly itemId: string;
  readonly secondItemSku: string;
  readonly secondItemId: string;
  readonly catalogueSku: string;
  readonly catalogueItemId: string;
}

/**
 * Seeds two mapped items and one catalogue-only SKU: enough to exercise SKU
 * matching, external-id fallback and the unmapped path. Conflict fixtures are
 * added per test so the resolver's directions stay explicit.
 */
export function seedImportFixture(store: FakeImportStore): ImportFixture {
  const fixture: ImportFixture = {
    organizationId: "org-1",
    otherOrganizationId: "org-2",
    actorId: "actor-1",
    source: "frontline-export",
    sourceSystem: "frontline",
    itemSku: "COF-01",
    itemId: "item-cof",
    secondItemSku: "TEA-01",
    secondItemId: "item-tea",
    catalogueSku: "NEW-01",
    catalogueItemId: "item-new",
  };

  const effectiveFrom = "2026-01-01T00:00:00.000Z";
  store.externalMappings.set("map-1", {
    id: "map-1",
    organizationId: fixture.organizationId,
    sourceSystem: fixture.sourceSystem,
    entityType: "item",
    externalId: "ext-cof",
    sku: fixture.itemSku,
    internalEntityType: "item",
    internalEntityId: fixture.itemId,
    effectiveFrom,
    effectiveTo: null,
  });
  store.externalMappings.set("map-2", {
    id: "map-2",
    organizationId: fixture.organizationId,
    sourceSystem: fixture.sourceSystem,
    entityType: "item",
    externalId: "ext-tea",
    sku: fixture.secondItemSku,
    internalEntityType: "item",
    internalEntityId: fixture.secondItemId,
    effectiveFrom,
    effectiveTo: null,
  });
  store.internalEntitiesBySku.set(skuKey(fixture.organizationId, "item", fixture.itemSku), {
    internalEntityId: fixture.itemId,
  });
  store.internalEntitiesBySku.set(skuKey(fixture.organizationId, "item", fixture.secondItemSku), {
    internalEntityId: fixture.secondItemId,
  });
  store.internalEntitiesBySku.set(skuKey(fixture.organizationId, "item", fixture.catalogueSku), {
    internalEntityId: fixture.catalogueItemId,
  });

  return fixture;
}
