import {
  DomainError,
  assertImportRunStatusTransition,
  resolveExternalEntity,
  type ExternalMappingCandidate,
} from "@aquarela/domain";

import { IMPORTS_AUDIT_ACTIONS } from "./actions";
import { IMPORT_DIAGNOSTIC_KEYS, type ImportMappingConflict } from "./diagnostics";
import type { ImportStore } from "./types";
import { readText } from "./validation";

export interface MapImportRowsInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly importRunId: string;
  /** Restrict the mapping rows consulted to one source system. */
  readonly sourceSystem?: string;
  /** Restrict to one external entity type (defaults to `item` for SKU lookups). */
  readonly entityType?: string;
}

export interface MappedRowResult {
  readonly stagingRowId: string;
  readonly sourceRowNo: number;
  readonly outcome: "mapped" | "unmapped" | "conflict" | "skipped";
  readonly internalEntityId?: string;
  readonly match?: "sku" | "external_id";
  readonly reason?: string;
  readonly kind?: string;
}

export interface MapImportRowsResult {
  readonly importRunId: string;
  readonly status: string;
  readonly mappedCount: number;
  readonly unmappedCount: number;
  readonly conflictCount: number;
  readonly skippedCount: number;
  readonly rows: readonly MappedRowResult[];
}

/**
 * Applies the domain resolver to every staged row and records the outcome
 * (`SALE-002`, `DEC-041`, step 5).
 *
 * Candidates come from the active `external_mapping` rows for the source/entity
 * type plus, when the row carries a SKU, the internal entity resolved by that
 * SKU (`DEC-041`: SKU is the primary key, the external mapping is the
 * fallback). The resolver's `conflict` outcome is **flagged and blocked**
 * (`DEC-033`): the row gets the first-class `mapping_state = conflict` with
 * `error_code = mapping_conflict` retained as detail (`DEC-074`), the conflict
 * is recorded in `diagnostics.conflicts`, and the row is never remapped in
 * place. A genuine mapping failure keeps `mapping_state = error`. Rows already
 * dispositioned `ignored` or carrying a non-conflict validation error are
 * skipped, so mapping cannot silently overwrite a human decision.
 *
 * There is no column for the resolved internal id, so it is recorded in the
 * row's `normalized` jsonb under `mapped_internal_entity_id`/`mapping_match`
 * (recorded open point). The run moves to `needs_review` while any row is
 * unmapped or in conflict, else `validated`. No posting happens here.
 */
export async function mapImportRows(
  store: ImportStore,
  input: MapImportRowsInput,
): Promise<MapImportRowsResult> {
  return store.withTransaction(async (tx) => {
    const run = await tx.findImportRun({
      organizationId: input.organizationId,
      importRunId: input.importRunId,
    });
    if (run === undefined) {
      throw new DomainError("import run not found in organization");
    }

    const mappings = await tx.listExternalMappings({
      organizationId: input.organizationId,
      ...(input.sourceSystem === undefined ? {} : { sourceSystem: input.sourceSystem }),
      ...(input.entityType === undefined ? {} : { entityType: input.entityType }),
    });
    const mappingCandidates: ExternalMappingCandidate[] = mappings.map((mapping) => ({
      internalEntityId: mapping.internalEntityId,
      sku: mapping.sku,
      externalId: mapping.externalId,
    }));

    const rows = await tx.listImportStagingRows({
      organizationId: input.organizationId,
      importRunId: run.id,
    });

    const results: MappedRowResult[] = [];
    const conflicts: ImportMappingConflict[] = [];
    let mappedCount = 0;
    let unmappedCount = 0;
    let skippedCount = 0;

    for (const row of rows) {
      if (
        row.mappingState === "ignored" ||
        (row.errorCode !== null && row.errorCode !== "mapping_conflict")
      ) {
        skippedCount += 1;
        results.push({
          stagingRowId: row.id,
          sourceRowNo: row.sourceRowNo,
          outcome: "skipped",
        });
        continue;
      }

      const sku = readText(row.normalized, "sku");
      const externalId = readText(row.normalized, "external_id");
      const candidates: ExternalMappingCandidate[] = [...mappingCandidates];
      if (sku !== null) {
        const entity = await tx.findEntityBySku({
          organizationId: input.organizationId,
          entityType: input.entityType ?? "item",
          sku,
        });
        if (entity !== undefined) {
          candidates.push({ internalEntityId: entity.internalEntityId, sku, externalId: null });
        }
      }

      const resolution = resolveExternalEntity({ sku, externalId, candidates });

      if (resolution.status === "matched") {
        await tx.updateImportStagingRow(row.id, {
          mappingState: "mapped",
          errorCode: null,
          normalized: {
            ...row.normalized,
            mapped_internal_entity_id: resolution.internalEntityId,
            mapping_match: resolution.match,
          },
        });
        mappedCount += 1;
        results.push({
          stagingRowId: row.id,
          sourceRowNo: row.sourceRowNo,
          outcome: "mapped",
          internalEntityId: resolution.internalEntityId,
          match: resolution.match,
        });
        continue;
      }

      if (resolution.status === "unmapped") {
        await tx.updateImportStagingRow(row.id, {
          mappingState: "unmapped",
          errorCode: null,
        });
        unmappedCount += 1;
        results.push({
          stagingRowId: row.id,
          sourceRowNo: row.sourceRowNo,
          outcome: "unmapped",
          reason: resolution.reason,
        });
        continue;
      }

      await tx.updateImportStagingRow(row.id, {
        mappingState: "conflict",
        errorCode: "mapping_conflict",
      });
      conflicts.push({
        stagingRowId: row.id,
        sourceRowNo: row.sourceRowNo,
        kind: resolution.kind,
        internalEntityIds: resolution.internalEntityIds,
        externalIds: resolution.externalIds,
      });
      results.push({
        stagingRowId: row.id,
        sourceRowNo: row.sourceRowNo,
        outcome: "conflict",
        kind: resolution.kind,
      });
    }

    const conflictCount = conflicts.length;
    const status =
      conflictCount > 0 || unmappedCount > 0
        ? "needs_review"
        : mappedCount + skippedCount > 0
          ? "validated"
          : run.status;
    if (status !== run.status) {
      assertImportRunStatusTransition(run.status, status);
    }

    const diagnostics = {
      ...run.diagnostics,
      [IMPORT_DIAGNOSTIC_KEYS.conflicts]: conflicts,
    };
    const rowCounts = {
      ...run.rowCounts,
      mapped: mappedCount,
      unmapped: unmappedCount,
      conflict: conflictCount,
    };

    const updated = await tx.updateImportRun(run.id, { status, rowCounts, diagnostics });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: IMPORTS_AUDIT_ACTIONS.rowsMapped,
      entityType: "import_run",
      entityId: run.id,
      after: {
        status: updated.status,
        mapped: mappedCount,
        unmapped: unmappedCount,
        conflict: conflictCount,
        skipped: skippedCount,
      },
    });

    return {
      importRunId: run.id,
      status: updated.status,
      mappedCount,
      unmappedCount,
      conflictCount,
      skippedCount,
      rows: results,
    };
  });
}
