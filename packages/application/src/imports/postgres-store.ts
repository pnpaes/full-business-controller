import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  ExternalMappingRecord,
  FindImportRunQuery,
  ImportProfileRecord,
  ImportRunRecord,
  ImportStagingRowRecord,
  ImportStore,
  ListExternalMappingsQuery,
  ListImportRunsQuery,
  NewImportProfileRecord,
  NewImportRunRecord,
  NewImportStagingRowRecord,
  UpdateImportRunValues,
  UpdateImportStagingRowValues,
} from "./types";

/**
 * Adapts the persistence import repositories to the `ImportStore` port.
 *
 * The persistence slice (migration `0022`, `repositories/imports.ts`) is the
 * schema authority; this adapter maps its rows to the port's ISO-string DTOs.
 * `import_run.period_start`/`period_end` are `date` columns (`yyyy-mm-dd`) and
 * stay strings; `timestamptz` values become ISO strings; the `row_counts`/
 * `diagnostics`/`raw`/`normalized` jsonb columns come back as `unknown` and are
 * narrowed defensively.
 *
 * Two repository gaps are bridged here rather than in persistence (which this
 * slice must not edit), both recorded as open points:
 * - there is no `findImportStagingRow`, so one row is found by listing the
 *   run's rows;
 * - there is no lookup by `file_hash`, so the replay guard matches the hash
 *   over the organization's runs; the `import_run_file_hash_key` unique index
 *   remains the real guard.
 *
 * `import_profile` (`DEC-081`) has real create/find repository functions, so
 * those are delegated directly and only mapped to the port's DTOs here.
 */

function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNumberRecord(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(toRecord(value))) {
    if (typeof entry === "number") {
      result[key] = entry;
    }
  }
  return result;
}

function toImportRun(row: repo.ImportRun): ImportRunRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: row.source,
    importProfileId: row.importProfileId,
    profileVersion: row.profileVersion,
    fileObjectId: row.fileObjectId,
    fileHash: row.fileHash,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    status: row.status,
    rowCounts: toNumberRecord(row.rowCounts),
    diagnostics: toRecord(row.diagnostics),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

function toImportProfile(row: repo.ImportProfile): ImportProfileRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: row.source,
    profileVersion: row.profileVersion,
    postingPolicy: row.postingPolicy,
    validationRules: toRecord(row.validationRules),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

function toStagingRow(row: repo.ImportStagingRow): ImportStagingRowRecord {
  return {
    id: row.id,
    importRunId: row.importRunId,
    sourceRowNo: row.sourceRowNo,
    raw: toRecord(row.raw),
    normalized: toRecord(row.normalized),
    mappingState: row.mappingState,
    errorCode: row.errorCode,
    linkedSalesLineId: row.linkedSalesLineId,
  };
}

function toExternalMapping(row: repo.ExternalMapping): ExternalMappingRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    sourceSystem: row.sourceSystem,
    entityType: row.entityType,
    externalId: row.externalId,
    sku: row.sku,
    internalEntityType: row.internalEntityType,
    internalEntityId: row.internalEntityId,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo === null ? null : row.effectiveTo.toISOString(),
  };
}

function newRunValues(input: NewImportRunRecord): repo.NewImportRun {
  return {
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
    createdBy: input.createdBy,
  };
}

function newImportProfileValues(input: NewImportProfileRecord): repo.NewImportProfile {
  return {
    organizationId: input.organizationId,
    source: input.source.trim(),
    profileVersion: input.profileVersion.trim(),
    postingPolicy: input.postingPolicy,
    validationRules: input.validationRules,
    createdBy: input.createdBy,
  };
}

function newStagingRowValues(input: NewImportStagingRowRecord): repo.NewImportStagingRow {
  return {
    importRunId: input.importRunId,
    sourceRowNo: input.sourceRowNo,
    raw: input.raw,
    normalized: input.normalized,
    mappingState: input.mappingState,
    errorCode: input.errorCode,
    linkedSalesLineId: input.linkedSalesLineId,
  };
}

export function createPostgresImportStore(db: Database): ImportStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresImportStore(db));
      }
      return db.transaction((tx) => fn(createPostgresImportStore(tx)));
    },
    findImportRun: async (query: FindImportRunQuery) => {
      if (query.importRunId !== undefined) {
        const row = await repo.findImportRun(db, {
          organizationId: query.organizationId,
          importRunId: query.importRunId,
        });
        return row === undefined ? undefined : toImportRun(row);
      }
      if (query.fileHash === undefined) {
        return undefined;
      }
      // No repository lookup by hash: match over the organization's runs. The
      // unique index is the real guard if this ever misses.
      const rows = await repo.listImportRuns(db, { organizationId: query.organizationId });
      const match = rows.find((row) => row.fileHash === query.fileHash);
      return match === undefined ? undefined : toImportRun(match);
    },
    listImportRuns: async (query: ListImportRunsQuery) => {
      const rows = await repo.listImportRuns(db, {
        organizationId: query.organizationId,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.source === undefined ? {} : { source: query.source }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toImportRun);
    },
    createImportRun: async (input) =>
      toImportRun(await repo.createImportRun(db, newRunValues(input))),
    findImportProfile: async (query) => {
      const row = await repo.findImportProfile(
        db,
        query.importProfileId !== undefined
          ? { organizationId: query.organizationId, importProfileId: query.importProfileId }
          : { organizationId: query.organizationId, source: query.source },
      );
      return row === undefined ? undefined : toImportProfile(row);
    },
    createImportProfile: async (input) =>
      toImportProfile(await repo.createImportProfile(db, newImportProfileValues(input))),
    updateImportRun: async (id, values: UpdateImportRunValues) => {
      const patch: repo.ImportRunPatch = {};
      if (values.status !== undefined) {
        patch.status = values.status;
      }
      if (values.rowCounts !== undefined) {
        patch.rowCounts = { ...values.rowCounts };
      }
      if (values.diagnostics !== undefined) {
        patch.diagnostics = { ...values.diagnostics };
      }
      const row = await repo.updateImportRun(db, id, patch);
      if (row === undefined) {
        throw new Error("import_run not found for update");
      }
      return toImportRun(row);
    },
    findImportStagingRow: async (query) => {
      const rows = await repo.listImportStagingRows(db, {
        organizationId: query.organizationId,
        importRunId: query.importRunId,
      });
      const row = rows.find((candidate) => candidate.id === query.stagingRowId);
      return row === undefined ? undefined : toStagingRow(row);
    },
    listImportStagingRows: async (query) =>
      (
        await repo.listImportStagingRows(db, {
          organizationId: query.organizationId,
          importRunId: query.importRunId,
        })
      ).map(toStagingRow),
    createImportStagingRow: async (input) =>
      toStagingRow(await repo.createImportStagingRow(db, newStagingRowValues(input))),
    updateImportStagingRow: async (id, values: UpdateImportStagingRowValues) => {
      const patch: repo.ImportStagingRowPatch = {};
      if (values.normalized !== undefined) {
        patch.normalized = values.normalized;
      }
      if (values.mappingState !== undefined) {
        patch.mappingState = values.mappingState;
      }
      if (values.errorCode !== undefined) {
        patch.errorCode = values.errorCode;
      }
      if (values.linkedSalesLineId !== undefined) {
        patch.linkedSalesLineId = values.linkedSalesLineId;
      }
      const row = await repo.updateImportStagingRow(db, id, patch);
      if (row === undefined) {
        throw new Error("import_staging_row not found for update");
      }
      return toStagingRow(row);
    },
    listExternalMappings: async (query: ListExternalMappingsQuery) =>
      (
        await repo.listExternalMappings(db, {
          organizationId: query.organizationId,
          ...(query.sourceSystem === undefined ? {} : { sourceSystem: query.sourceSystem }),
          ...(query.entityType === undefined ? {} : { entityType: query.entityType }),
        })
      ).map(toExternalMapping),
    findEntityBySku: async (query) => {
      // Only `item` has a repository SKU lookup today (recorded open point);
      // product variants and other entity types resolve to `undefined`.
      if (query.entityType !== "item") {
        return undefined;
      }
      const item = await repo.findItemBySku(db, query.organizationId, query.sku);
      return item === undefined ? undefined : { internalEntityId: item.id };
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
