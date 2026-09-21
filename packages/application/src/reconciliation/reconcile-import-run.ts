import {
  DomainError,
  MONEY_SCALE,
  formatDecimal,
  parseDecimal,
  withinTolerance,
} from "@aquarela/domain";

import { readTotals } from "../imports/diagnostics";
import type { ImportStagingRowRecord } from "../imports";
import { isPlainObject, readText } from "../imports/validation";
import { readMoneyOrNull } from "../sales/validation";

import { RECONCILIATION_AUDIT_ACTIONS } from "./actions";
import type { ReconciliationStore } from "./types";
import { assertReconciliationScopeType, resolveEffectiveTolerance } from "./validation";

export interface ReconcileImportRunInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly importRunId: string;
  /** `reconciliation.scope_type`; defaults to the slice-owned `import_run`. */
  readonly scopeType?: string;
  /** Explicit tolerance override; wins over the `DEC-072` config. */
  readonly tolerance?: string;
  /**
   * Explicit opt-in to the published `DEC-026` default, used only when no
   * effective `DEC-072` config row covers the run's period end.
   */
  readonly useDecisionDefaultTolerance?: boolean;
  readonly ownerId?: string | null;
  /** `yyyy-mm-dd`. */
  readonly dueDate?: string | null;
}

export interface ReconcileImportRunResult {
  readonly reconciliationId: string;
  readonly status: string;
  /** numeric(19,4). */
  readonly expected: string;
  readonly actual: string;
  readonly tolerance: string;
  readonly difference: string;
  /** The source total less posted less approved dispositions, at money scale. */
  readonly residual: string;
  readonly created: boolean;
}

function grossOf(row: ImportStagingRowRecord): bigint {
  return isPlainObject(row.normalized)
    ? (() => {
        const value = readMoneyOrNull(row.normalized, "gross_amount");
        return value === null ? 0n : parseDecimal(value, MONEY_SCALE);
      })()
    : 0n;
}

/**
 * Reconciles a posted import run (`REC-005`, `DEC-035`): the source total is
 * compared against `posted + approved dispositions (unmapped/rejected/ignored)`,
 * and the tolerance applies to the residual **after** dispositions, not the raw
 * posted total.
 *
 * - The run must be `posted` or `partially_posted` (a run that has not posted
 *   cannot be reconciled).
 * - **Close is blocked while a non-posted row lacks an approved disposition**
 *   (`DEC-035`): the command throws before writing anything, so an import
 *   cannot close with an unreviewed row.
 * - The tolerance precedence is `DEC-072`: an explicit override wins, else the
 *   `reconciliation_tolerance` config effective at the run's period end (`run.periodEnd`)
 *   is applied as `max(rate × |expected|, floorAmount)`, else an explicit opt-in
 *   to the published `DEC-026` default; a missing tolerance blocks close and is
 *   never defaulted silently.
 * - The result is one `reconciliation` row (scope `import_run`) with status
 *   `within_tolerance` or `exception`; re-running for the same scope/period
 *   updates the existing row's status rather than creating a duplicate.
 */
export async function reconcileImportRun(
  store: ReconciliationStore,
  input: ReconcileImportRunInput,
): Promise<ReconcileImportRunResult> {
  return store.withTransaction(async (tx) => {
    assertReconciliationScopeType(input.scopeType);
    const run = await tx.findImportRun({
      organizationId: input.organizationId,
      importRunId: input.importRunId,
    });
    if (run === undefined) {
      throw new DomainError("import run not found in organization");
    }
    if (run.status !== "posted" && run.status !== "partially_posted") {
      throw new DomainError(
        `import run is not posted and cannot be reconciled (status ${run.status})`,
      );
    }

    const rows = await tx.listImportStagingRows({
      organizationId: input.organizationId,
      importRunId: run.id,
    });
    const dispositioned = new Set(
      (
        await tx.listImportDispositions({
          organizationId: input.organizationId,
          importRunId: run.id,
        })
      ).map((disposition) => disposition.stagingRowId),
    );

    // DEC-035: an import cannot close while a non-posted row lacks an approved
    // disposition. Checked before any write so nothing is created.
    for (const row of rows) {
      if (row.linkedSalesLineId === null && !dispositioned.has(row.id)) {
        throw new DomainError(
          `import run cannot close: staging row ${row.sourceRowNo} is not posted and has no approved disposition (DEC-035)`,
        );
      }
    }

    const totals = readTotals(run.diagnostics);
    let currency: string | null = null;
    if (totals !== null) {
      const currencies = Object.keys(totals);
      if (currencies.length > 1) {
        throw new DomainError(
          "a multi-currency import run cannot be reconciled into one reconciliation row",
        );
      }
      currency = currencies[0] ?? null;
    }
    if (currency === null) {
      for (const row of rows) {
        if (isPlainObject(row.normalized)) {
          const rowCurrency = readText(row.normalized, "currency");
          if (rowCurrency !== null) {
            currency = rowCurrency;
            break;
          }
        }
      }
    }
    if (currency === null) {
      throw new DomainError("import run has no currency to reconcile");
    }

    const sourceTotal =
      totals?.[currency] ??
      formatDecimal(
        rows.reduce((sum, row) => sum + grossOf(row), 0n),
        MONEY_SCALE,
      );
    const postedTotal = rows
      .filter((row) => row.linkedSalesLineId !== null)
      .reduce((sum, row) => sum + grossOf(row), 0n);
    const dispositionTotal = rows
      .filter((row) => row.linkedSalesLineId === null && dispositioned.has(row.id))
      .reduce((sum, row) => sum + grossOf(row), 0n);

    const expected = parseDecimal(sourceTotal, MONEY_SCALE);
    const actualUnits = postedTotal + dispositionTotal;
    const actual = formatDecimal(actualUnits, MONEY_SCALE);
    const tolerance = await resolveEffectiveTolerance(tx, {
      organizationId: input.organizationId,
      kind: "sales_settlement",
      asOf: run.periodEnd,
      expected: sourceTotal,
      ...(input.tolerance === undefined ? {} : { tolerance: input.tolerance }),
      ...(input.useDecisionDefaultTolerance === undefined
        ? {}
        : { useDecisionDefaultTolerance: input.useDecisionDefaultTolerance }),
    });
    const evaluation = withinTolerance({
      expected: sourceTotal,
      actual,
      kind: "sales_settlement",
      tolerance,
    });
    const status = evaluation.withinTolerance ? "within_tolerance" : "exception";
    const scopeType = input.scopeType ?? "import_run";

    const existing = await tx.findReconciliationByScope({
      organizationId: input.organizationId,
      scopeType,
      scopeId: run.id,
      periodStart: run.periodStart,
    });

    let reconciliationId: string;
    let created: boolean;
    if (existing !== undefined) {
      const updated = await tx.updateReconciliation(
        { organizationId: input.organizationId, reconciliationId: existing.id },
        {
          status,
          updatedBy: input.actorId,
          ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
          ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
        },
      );
      if (updated === undefined) {
        throw new DomainError("reconciliation not found for update");
      }
      reconciliationId = updated.id;
      created = false;
    } else {
      const record = await tx.createReconciliation({
        organizationId: input.organizationId,
        scopeType,
        scopeId: run.id,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        expectedAmount: formatDecimal(expected, MONEY_SCALE),
        actualAmount: actual,
        tolerance,
        difference: evaluation.difference,
        status,
        ownerId: input.ownerId ?? null,
        dueDate: input.dueDate ?? null,
        createdBy: input.actorId,
      });
      reconciliationId = record.id;
      created = true;
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: RECONCILIATION_AUDIT_ACTIONS.importRunReconciled,
      entityType: "reconciliation",
      entityId: reconciliationId,
      after: {
        import_run_id: run.id,
        status,
        expected: formatDecimal(expected, MONEY_SCALE),
        actual,
        tolerance,
        difference: evaluation.difference,
        residual: evaluation.difference,
      },
    });

    return {
      reconciliationId,
      status,
      expected: formatDecimal(expected, MONEY_SCALE),
      actual,
      tolerance,
      difference: evaluation.difference,
      residual: evaluation.difference,
      created,
    };
  });
}
