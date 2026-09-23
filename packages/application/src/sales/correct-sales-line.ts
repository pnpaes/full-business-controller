import { DomainError } from "@aquarela/domain";

import { isBlank } from "../imports/validation";

import { reverseSalesLine } from "./reverse-sales-line";
import type { CorrectSalesLineStore } from "./types";

export interface CorrectSalesLineInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly salesLineId: string;
  /** Mandatory; recorded in the audit (`DEC-073`/`DEC-116`). */
  readonly reasonCode: string;
}

/** Mirrors the route's `MAX_TEXT` cap so a direct caller cannot write more. */
const MAX_REASON_CODE_LENGTH = 200;

export interface CorrectSalesLineResult {
  /** The new, negated `sales_line`; the original is never edited or deleted. */
  readonly reversalSalesLineId: string;
  /** One exact reversal per original `sales_line`-sourced movement. */
  readonly reversedMovementIds: readonly string[];
  /** Residual value-only corrections the reversal primitive demanded (`DEC-028`). */
  readonly revaluationMovementIds: readonly string[];
}

/**
 * Corrects one posted sales line end to end (`DEC-116`, `DEC-028`/`DEC-073`):
 * in **one transaction** it (a) reverses the line through `reverseSalesLine`
 * (a new negated line, the original untouched) and (b) reverses every
 * un-reversed, non-reversal `stock_movement` posted for it (`source_type =
 * 'sales_line'`, `source_id = the original line id`) through the inventory
 * `reverseStockMovement` primitive — exact quantity and value, with a residual
 * `revaluation` where the primitive demands one.
 *
 * **Ledger convention:** the reversal movements copy the original movement's
 * `source_type`/`source_id` (the primitive's existing behaviour, unchanged), so
 * the reporting `lineCostExpression` nets the original line's cost to zero and
 * the reversal line carries zero cost. The reversal line is never the
 * `source_id`.
 *
 * **Atomicity:** both steps run against the transaction-bound store from the
 * single `withTransaction`, so a partial correction cannot persist. The
 * transaction runner is the port's; the Postgres adapter opens one
 * `db.transaction` (the primitive's own `withTransaction` nests as a savepoint
 * inside it).
 *
 * **Idempotency is rejection, not replay:** a line that already has a reversal
 * is rejected by `reverseSalesLine` (the partial unique index
 * `sales_line_reversal_of_id_key` is the backstop) and a movement that already
 * has a reversal is rejected on `reversal:<movementId>`, so a retry reverses
 * nothing further. A line with no consumption movements is fine (zero
 * movements reversed). Full negation only — there is no partial/delta path.
 *
 * `reasonCode` is mandatory and recorded in the line audit and every movement
 * audit. There is no approval workflow and no `adjustment_period` linkage.
 */
export async function correctSalesLine(
  store: CorrectSalesLineStore,
  input: CorrectSalesLineInput,
): Promise<CorrectSalesLineResult> {
  if (isBlank(input.reasonCode)) {
    throw new DomainError("reasonCode is required for a reversal");
  }
  if (input.reasonCode.trim().length > MAX_REASON_CODE_LENGTH) {
    throw new DomainError(`reasonCode must be at most ${MAX_REASON_CODE_LENGTH} characters`);
  }
  const salesLineId = input.salesLineId.trim();

  return store.withTransaction(async (tx) => {
    // (a) The line-level primitive validates existence, organization ownership,
    // that the line is not itself a reversal and that it is not already
    // reversed; it posts no stock.
    const reversal = await reverseSalesLine(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      salesLineId,
      reasonCode: input.reasonCode,
    });

    // (b) Reverse every still-correctable movement the original line posted.
    // `onlyReversible` keeps the set to the un-reversed originals: a movement
    // that is itself a reversal (it copies the original's source) and one that
    // already has a reversal are both excluded, so a partially-reversed line is
    // corrected without a double-reverse or a wedge.
    const movements = await tx.listStockMovementsBySource({
      organizationId: input.organizationId,
      sourceType: "sales_line",
      sourceId: salesLineId,
      onlyReversible: true,
    });

    const reversedMovementIds: string[] = [];
    const revaluationMovementIds: string[] = [];
    for (const movement of movements) {
      const result = await tx.reverseStockMovement({
        organizationId: input.organizationId,
        actorId: input.actorId,
        movementId: movement.id,
        reasonCode: input.reasonCode,
      });
      reversedMovementIds.push(result.reversalMovementId);
      if (result.revaluationMovementId !== null) {
        revaluationMovementIds.push(result.revaluationMovementId);
      }
    }

    return {
      reversalSalesLineId: reversal.reversalSalesLineId,
      reversedMovementIds,
      revaluationMovementIds,
    };
  });
}
