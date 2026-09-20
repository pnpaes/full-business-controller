import {
  DomainError,
  MONEY_SCALE,
  formatDecimal,
  parseDecimal,
  withinTolerance,
} from "@aquarela/domain";

import { RECONCILIATION_AUDIT_ACTIONS } from "./actions";
import type { ReconciliationStore } from "./types";
import { resolveTolerance } from "./validation";

export interface ReconcileSettlementInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly settlementId: string;
  /** `reconciliation.scope_type`; defaults to the slice-owned `settlement`. */
  readonly scopeType?: string;
  readonly tolerance?: string;
  readonly useDecisionDefaultTolerance?: boolean;
  readonly ownerId?: string | null;
  /** `yyyy-mm-dd`. */
  readonly dueDate?: string | null;
}

export interface ReconcileSettlementResult {
  readonly reconciliationId: string;
  readonly status: string;
  /** numeric(19,4): the settlement's paid amount (the provider's source). */
  readonly expected: string;
  /** numeric(19,4): the posted sales total for the channel/period. */
  readonly actual: string;
  readonly tolerance: string;
  readonly difference: string;
  readonly created: boolean;
}

/**
 * Reconciles a channel settlement against sales (`REC-001`/`REC-002`,
 * `DEC-026`, `DEC-040`).
 *
 * `expected` is the settlement's `paid_amount` (the provider's own source total:
 * Wolt/Foodora own their sales facts and provide payout reports directly —
 * `DEC-040`); `actual` is the posted sales total for the same channel and
 * period. The `DEC-026` sales/settlement tolerance (`max(0.5%, 5 NOK)`) is
 * applied to the difference and the outcome is `within_tolerance` or
 * `exception`.
 *
 * As with `reconcileImportRun`, the tolerance is an explicit override or an
 * explicit opt-in to the published default; there is no tolerance table, so a
 * missing tolerance never defaults silently. `settlement.status` has no
 * vocabulary (open point (i)), so it is stored facts only and the reconciliation
 * is the judgement.
 */
export async function reconcileSettlement(
  store: ReconciliationStore,
  input: ReconcileSettlementInput,
): Promise<ReconcileSettlementResult> {
  return store.withTransaction(async (tx) => {
    const settlement = await tx.findSettlement({
      organizationId: input.organizationId,
      settlementId: input.settlementId,
    });
    if (settlement === undefined) {
      throw new DomainError("settlement not found in organization");
    }
    if (settlement.paidAmount === null) {
      throw new DomainError("settlement has no paid amount to reconcile");
    }

    const actual = await tx.sumSalesForChannelPeriod({
      organizationId: input.organizationId,
      channelId: settlement.channelId,
      periodStart: settlement.periodStart,
      periodEnd: settlement.periodEnd,
      currency: settlement.currency,
    });
    // `paid_amount` is numeric(19,4); normalizing keeps the format path
    // identical to the import-run reconciliation.
    const expected = formatDecimal(parseDecimal(settlement.paidAmount, MONEY_SCALE), MONEY_SCALE);
    const tolerance = resolveTolerance({
      kind: "sales_settlement",
      expected,
      ...(input.tolerance === undefined ? {} : { tolerance: input.tolerance }),
      ...(input.useDecisionDefaultTolerance === undefined
        ? {}
        : { useDecisionDefaultTolerance: input.useDecisionDefaultTolerance }),
    });
    const evaluation = withinTolerance({
      expected,
      actual,
      kind: "sales_settlement",
      tolerance,
    });
    const status = evaluation.withinTolerance ? "within_tolerance" : "exception";
    const scopeType = input.scopeType ?? "settlement";

    const existing = await tx.findReconciliationByScope({
      organizationId: input.organizationId,
      scopeType,
      scopeId: settlement.id,
      periodStart: settlement.periodStart,
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
        scopeId: settlement.id,
        periodStart: settlement.periodStart,
        periodEnd: settlement.periodEnd,
        expectedAmount: expected,
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
      action: RECONCILIATION_AUDIT_ACTIONS.settlementReconciled,
      entityType: "reconciliation",
      entityId: reconciliationId,
      after: {
        settlement_id: settlement.id,
        provider: settlement.provider,
        status,
        expected,
        actual,
        tolerance,
        difference: evaluation.difference,
      },
    });

    return {
      reconciliationId,
      status,
      expected,
      actual,
      tolerance,
      difference: evaluation.difference,
      created,
    };
  });
}
