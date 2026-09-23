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
  /**
   * The internal entity type the rows resolve to (`DEC-113`). When set, the
   * external mappings are narrowed to it, the SKU lookup targets it, the
   * candidates are window-checked against each row's `occurred_at`, and a match
   * on `product_variant` writes `normalized.product_variant_id`.
   */
  readonly internalEntityType?: string;
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
 * `DEC-113`: a mapping is effective for an instant when the half-open
 * `[effective_from, effective_to)` window covers it (`effective_to` null is
 * open). Both bounds are ISO `timestamptz` strings on the port.
 */
function isEffectiveAt(
  mapping: { readonly effectiveFrom: string; readonly effectiveTo: string | null },
  occurredAt: number,
): boolean {
  if (Date.parse(mapping.effectiveFrom) > occurredAt) {
    return false;
  }
  return mapping.effectiveTo === null || occurredAt < Date.parse(mapping.effectiveTo);
}

/**
 * `DEC-113`: the mapping keys a previous match may have written. A row re-mapped
 * to `unmapped`/`conflict` must not keep them, or a stale variant id would
 * survive the remap and be read into `sales_line.product_variant_id`.
 */
const MAPPING_KEYS = ["product_variant_id", "mapped_internal_entity_id", "mapping_match"] as const;

function withoutMappingKeys(
  normalized: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(normalized)) {
    if (!(MAPPING_KEYS as readonly string[]).includes(key)) {
      next[key] = value;
    }
  }
  return next;
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
 * When the caller passes `internalEntityType` (`DEC-113`, the sales import
 * passes `product_variant`), the external-mapping candidates are additionally
 * narrowed per row to those effective at the row's `occurred_at` — the
 * half-open `[effective_from, effective_to)` window the reporting chain uses;
 * a row with no parseable `occurred_at` skips the window check. A match then
 * writes `normalized.product_variant_id` alongside the existing keys, which is
 * the key `postImportRun` already reads into `sales_line.product_variant_id`;
 * the item path is unchanged and never writes it.
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
      ...(input.internalEntityType === undefined
        ? {}
        : { internalEntityType: input.internalEntityType }),
    });
    const resolvedEntityType = input.internalEntityType ?? input.entityType ?? "item";

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
      const occurredAtRaw = readText(row.normalized, "occurred_at");
      const occurredAt =
        occurredAtRaw !== null && !Number.isNaN(Date.parse(occurredAtRaw))
          ? Date.parse(occurredAtRaw)
          : null;
      const candidates: ExternalMappingCandidate[] = [];
      for (const mapping of mappings) {
        // `DEC-113`: the window check applies whenever an `internalEntityType` is
        // supplied; a row with no parseable `occurred_at` is not window-filtered.
        if (
          input.internalEntityType !== undefined &&
          occurredAt !== null &&
          !isEffectiveAt(mapping, occurredAt)
        ) {
          continue;
        }
        candidates.push({
          internalEntityId: mapping.internalEntityId,
          sku: mapping.sku,
          externalId: mapping.externalId,
        });
      }
      if (sku !== null) {
        const entity = await tx.findEntityBySku({
          organizationId: input.organizationId,
          entityType: resolvedEntityType,
          sku,
        });
        if (entity !== undefined) {
          candidates.push({ internalEntityId: entity.internalEntityId, sku, externalId: null });
        }
      }

      const resolution = resolveExternalEntity({ sku, externalId, candidates });

      if (resolution.status === "matched") {
        const normalized: Record<string, unknown> = {
          ...row.normalized,
          mapped_internal_entity_id: resolution.internalEntityId,
          mapping_match: resolution.match,
        };
        if (input.internalEntityType === "product_variant") {
          normalized.product_variant_id = resolution.internalEntityId;
        }
        await tx.updateImportStagingRow(row.id, {
          mappingState: "mapped",
          errorCode: null,
          normalized,
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
          normalized: withoutMappingKeys(row.normalized),
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
        normalized: withoutMappingKeys(row.normalized),
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
