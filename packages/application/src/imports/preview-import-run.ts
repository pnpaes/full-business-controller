import { DomainError } from "@aquarela/domain";

import { readDispositions, readTotals } from "./diagnostics";
import type { ImportStagingRowRecord, ImportStore } from "./types";
import { isDecimalString, readText, subtractMoney, sumMoney } from "./validation";
import type { MoneyTotals } from "./validation";

export interface PreviewImportRunInput {
  readonly organizationId: string;
  readonly importRunId: string;
}

export interface ImportRunPreview {
  readonly importRunId: string;
  readonly status: string;
  readonly rowCount: number;
  readonly mappedCount: number;
  readonly unmappedCount: number;
  readonly ignoredCount: number;
  readonly erroredCount: number;
  readonly conflictCount: number;
  /**
   * Rows that are neither mapped nor covered by an approved disposition. The
   * run cannot close while this is non-empty (`DEC-035`).
   */
  readonly undecidedRowIds: readonly string[];
  /** Per-currency `gross_amount` totals from validation, or null if never validated. */
  readonly sourceTotals: MoneyTotals | null;
  /** Always `{}` in slice 11 — posting is slice 12 (`ADR-0008`). */
  readonly postedTotals: MoneyTotals;
  /** Per-currency totals of rows carrying an approved disposition. */
  readonly dispositionTotals: MoneyTotals;
  /** `source - posted - dispositions`; null when no source totals were recorded. */
  readonly residualTotals: MoneyTotals | null;
  /** True when no undecided row remains (`DEC-035`). */
  readonly canClose: boolean;
}

function dispositionedRowIds(diagnostics: Readonly<Record<string, unknown>>): Set<string> {
  return new Set(readDispositions(diagnostics).map((disposition) => disposition.stagingRowId));
}

function isUndecided(row: ImportStagingRowRecord, dispositioned: ReadonlySet<string>): boolean {
  if (row.linkedSalesLineId !== null) {
    return false;
  }
  if (row.mappingState === "mapped" || row.mappingState === "ignored") {
    return false;
  }
  return !dispositioned.has(row.id);
}

/**
 * Read-only reconciliation preview (`SALE-007`, step 6; `DEC-035`): the source
 * totals versus the mapped/unmapped/errored counts and the residual.
 *
 * The run **cannot close while any non-posted row lacks an approved
 * disposition** (`DEC-035`): `canClose` is false whenever `undecidedRowIds` is
 * non-empty. Slice 11 posts nothing, so `postedTotals` is `{}` and the residual
 * is `source - dispositions`; that residual is reported for visibility only —
 * the amount-level tolerance (`DEC-026`, effective-dated config per `DEC-072`) is
 * applied by slice 12's reconcile commands, so it does not gate `canClose` here.
 *
 * Pure read: no writes and no transaction.
 */
export async function previewImportRun(
  store: ImportStore,
  input: PreviewImportRunInput,
): Promise<ImportRunPreview> {
  const run = await store.findImportRun({
    organizationId: input.organizationId,
    importRunId: input.importRunId,
  });
  if (run === undefined) {
    throw new DomainError("import run not found in organization");
  }
  const rows = await store.listImportStagingRows({
    organizationId: input.organizationId,
    importRunId: run.id,
  });

  const dispositioned = dispositionedRowIds(run.diagnostics);
  const undecidedRowIds = rows
    .filter((row) => isUndecided(row, dispositioned))
    .map((row) => row.id);

  let mappedCount = 0;
  let unmappedCount = 0;
  let ignoredCount = 0;
  let erroredCount = 0;
  let conflictCount = 0;
  for (const row of rows) {
    if (row.mappingState === "mapped") {
      mappedCount += 1;
    } else if (row.mappingState === "unmapped") {
      unmappedCount += 1;
    } else if (row.mappingState === "ignored") {
      ignoredCount += 1;
    } else if (row.mappingState === "conflict") {
      conflictCount += 1;
    } else {
      erroredCount += 1;
    }
  }

  const sourceTotals = readTotals(run.diagnostics);
  const postedTotals: MoneyTotals = {};
  const dispositionTotals = sumMoney(
    rows.flatMap((row) => {
      if (!dispositioned.has(row.id)) {
        return [];
      }
      const currency = readText(row.normalized, "currency");
      const amount = readText(row.normalized, "gross_amount");
      return currency === null || amount === null || !isDecimalString(amount)
        ? []
        : [{ currency, amount }];
    }),
  );
  const residualTotals =
    sourceTotals === null
      ? null
      : subtractMoney(subtractMoney(sourceTotals, postedTotals), dispositionTotals);

  const canClose = undecidedRowIds.length === 0;

  return {
    importRunId: run.id,
    status: run.status,
    rowCount: rows.length,
    mappedCount,
    unmappedCount,
    ignoredCount,
    erroredCount,
    conflictCount,
    undecidedRowIds,
    sourceTotals,
    postedTotals,
    dispositionTotals,
    residualTotals,
    canClose,
  };
}
