import {
  applyStockMovement,
  DomainError,
  formatDecimal,
  outputUnitCost,
  parseDecimal,
  STOCK_QUANTITY_SCALE,
  STOCK_VALUE_SCALE,
  yieldVariancePct,
} from "@aquarela/domain";

import { assertOptionalIsoDate } from "../costing/validation";
import { postStockMovements } from "../inventory";
import type { StockBalanceKey } from "../inventory";
import { assertIsoInstant, isBlank } from "../inventory/validation";
import { PRODUCTION_AUDIT_ACTIONS } from "./actions";
import { resolvePlannedSnapshot } from "./recipe-snapshot";
import type { ProductionStore } from "./types";

export interface CompleteProductionBatchInputLine {
  readonly itemId: string;
  /** numeric(19,6), in the item base unit, `>= 0`. */
  readonly actualQty: string;
  /** Existing `stock_lot` id, or null. */
  readonly lotId?: string | null;
  /** `production_batch_input.reason_code`; required when the variance is non-zero (PROD-004). */
  readonly reasonCode?: string | null;
}

export interface CompleteProductionBatchOutput {
  /** Must be the recipe version's output item (open point (c): no other output). */
  readonly itemId: string;
  /** numeric(19,6), in the item base unit, `> 0`. */
  readonly actualQty: string;
  readonly lotId?: string | null;
  /** `yyyy-mm-dd`, optional. */
  readonly expiryDate?: string | null;
}

export interface CompleteProductionBatchInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly productionBatchId: string;
  /** ISO instant; the ledger `occurred_at` (`PROD-002`). */
  readonly actualFinish: string;
  /**
   * The storage area inputs are drawn from. Required when the recipe has input
   * lines: there is no WIP/source-draw storage area on the batch (open point
   * (e)), so the caller supplies the draw area rather than a value being
   * invented.
   */
  readonly inputStorageAreaId?: string | null;
  readonly inputs: readonly CompleteProductionBatchInputLine[];
  readonly output: CompleteProductionBatchOutput;
  readonly allowNegativeOverride?: boolean;
  /** Optional key; a retry with the same key replays instead of double-posting. */
  readonly idempotencyKey?: string | null;
}

export interface CompleteProductionBatchResult {
  readonly productionBatchId: string;
  readonly status: string;
  /** numeric(19,6). */
  readonly actualOutputQty: string;
  /** numeric(9,6), signed fraction. */
  readonly yieldVariancePct: string;
  /** numeric(19,4): Σ consumption value booked by the ledger. */
  readonly inputValue: string;
  /** numeric(19,4): the unit cost posted on the output movement (B3). */
  readonly outputUnitCost: string;
  readonly movementIds: readonly string[];
  readonly inputCount: number;
  readonly outputCount: number;
  readonly replayed: boolean;
}

/** A movement in the single atomic `postStockMovements` batch. */
interface PlannedMovement {
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly itemId: string;
  readonly movementType: string;
  readonly quantityDelta: string;
  readonly unitCost: string | null;
  readonly lotId: string | null;
  readonly reasonCode: string | null;
}

interface ResolvedInput {
  readonly itemId: string;
  readonly unitId: string;
  readonly plannedQty: string;
  readonly actualQty: string;
  readonly varianceQty: string;
  readonly lotId: string | null;
  readonly reasonCode: string | null;
}

/**
 * Completes a batch atomically (`PROD-002`, `PROD-004`, `PROD-003`):
 *
 * 1. validates the actuals against the planned snapshot re-derived from the
 *    immutable approved recipe version (approval was enforced at creation,
 *    `PROD-001`), requiring an explicit reason on every non-zero input variance;
 * 2. derives the consumption value from each **locked** balance with the same
 *    domain rule the ledger uses (`applyStockMovement`, ADR-0005) — the fixed
 *    `unitCost: null` values the consumption at the locked moving weighted
 *    average — and computes the output unit cost from that actual input value
 *    and the actual output (`outputUnitCost`, CALCULATION_CONTRACT §6 B3);
 * 3. posts **one** `postStockMovements` batch (consumption lines negative,
 *    output positive, `sourceType "production_batch"`, `sourceId` = batch id,
 *    `occurredAt` = finish);
 * 4. writes the planned+actual+variance+reason input/output line rows with their
 *    `movement_id`s, and marks the batch `completed` with `actual_finish`,
 *    `actual_output_qty` and `yield_variance_pct`.
 *
 * **WASTE-002:** expected trim/cooking loss lives in the yield rule and is
 * **not** posted as a `waste` movement here — this command never posts
 * `movementType: "waste"`. Only an explicitly recorded abnormal loss becomes a
 * `waste_event` (the waste slice, linked by `waste_event.production_batch_id`).
 *
 * Recorded open points, not resolved: `PROD-003` has **no tolerance threshold**
 * yet, so a non-zero yield variance is recorded **unconditionally** as a
 * `yield_variance` `data_quality_exception` (provisional, pending the FIN
 * tolerance thresholds) rather than being checked against one; `DEC-036`
 * partial-portion handling **has no column**, so output lines carry base-unit
 * quantities only; and the batch is **single output** because cost allocation
 * across multiple outputs is undefined (open point (c)).
 *
 * The whole completion runs in one transaction, so the postings, the line rows,
 * the header and the audit fact commit or roll back together. The batch header
 * already exists (its id is the movements' `source_id`), satisfying migration
 * `0021`'s `stock_movement_source_guard` BEFORE INSERT trigger.
 */
export async function completeProductionBatch(
  store: ProductionStore,
  input: CompleteProductionBatchInput,
): Promise<CompleteProductionBatchResult> {
  assertIsoInstant(input.actualFinish, "actualFinish");
  assertOptionalIsoDate(input.output.expiryDate, "expiryDate");

  const actualOutputQty = parseDecimal(input.output.actualQty, STOCK_QUANTITY_SCALE);
  if (actualOutputQty <= 0n) {
    throw new DomainError("actual output quantity must be positive to complete a batch");
  }
  const seenItems = new Set<string>();
  for (const line of input.inputs) {
    if (seenItems.has(line.itemId)) {
      throw new DomainError(`duplicate actual for input item ${line.itemId}`);
    }
    seenItems.add(line.itemId);
    if (parseDecimal(line.actualQty, STOCK_QUANTITY_SCALE) < 0n) {
      throw new DomainError("actual input quantity must not be negative");
    }
  }
  const idempotencyKey = input.idempotencyKey ?? null;
  if (idempotencyKey !== null && idempotencyKey.includes(":")) {
    throw new DomainError("idempotencyKey must not contain ':'");
  }

  return store.withTransaction(async (tx) => {
    const batch = await tx.findProductionBatch({
      organizationId: input.organizationId,
      productionBatchId: input.productionBatchId,
    });
    if (batch === undefined) {
      throw new DomainError("production batch not found in organization");
    }

    if (idempotencyKey !== null) {
      const existing = await tx.findStockMovementByIdempotencyKey(
        input.organizationId,
        `${idempotencyKey}:0`,
      );
      if (
        existing !== undefined &&
        existing.sourceType === "production_batch" &&
        existing.sourceId === batch.id
      ) {
        return replayResult(
          tx,
          input.organizationId,
          batch.id,
          batch.actualOutputQty ?? "0.000000",
          batch.yieldVariancePct,
        );
      }
    }

    if (batch.status !== "in_progress") {
      throw new DomainError(
        `a batch can only be completed from in_progress (current: ${batch.status})`,
      );
    }

    const version = await tx.findRecipeVersion(batch.recipeVersionId);
    if (version === undefined) {
      throw new DomainError("recipe version not found");
    }
    const snapshot = await resolvePlannedSnapshot(tx, {
      organizationId: input.organizationId,
      version,
      asOf: new Date(input.actualFinish),
    });

    if (batch.destinationStorageAreaId === null) {
      throw new DomainError(
        "the batch has no destination storage area; set one before completing (open point (e))",
      );
    }
    const destination = await tx.findStorageArea(batch.destinationStorageAreaId);
    if (destination === undefined || destination.organizationId !== input.organizationId) {
      throw new DomainError("destination storage area not found in organization");
    }
    if (destination.locationId !== batch.locationId) {
      throw new DomainError("destination storage area does not belong to the batch location");
    }

    if (snapshot.inputs.length > 0) {
      if (input.inputStorageAreaId === undefined || input.inputStorageAreaId === null) {
        throw new DomainError(
          "inputStorageAreaId is required to draw production inputs (no WIP area exists — open point (e))",
        );
      }
      const drawArea = await tx.findStorageArea(input.inputStorageAreaId);
      if (drawArea === undefined || drawArea.organizationId !== input.organizationId) {
        throw new DomainError("input storage area not found in organization");
      }
      if (drawArea.locationId !== batch.locationId) {
        throw new DomainError("input storage area does not belong to the batch location");
      }
    }

    const plannedInputs = snapshot.inputs;
    const plannedItems = new Set(plannedInputs.map((line) => line.itemId));
    if (plannedItems.size !== plannedInputs.length) {
      throw new DomainError(
        "a recipe with two lines for the same input item is not supported: batch input " +
          "rows have no line key to attach the actual to (open point)",
      );
    }
    const actualByItem = new Map(input.inputs.map((line) => [line.itemId, line]));

    const resolvedInputs: ResolvedInput[] = [];
    for (const planned of plannedInputs) {
      const actual = actualByItem.get(planned.itemId);
      if (actual === undefined) {
        throw new DomainError(`missing actual quantity for input item ${planned.itemId}`);
      }
      const actualQty = parseDecimal(actual.actualQty, STOCK_QUANTITY_SCALE);
      const varianceQty = actualQty - parseDecimal(planned.plannedQty, STOCK_QUANTITY_SCALE);
      const reasonCode = actual.reasonCode ?? null;
      if (varianceQty !== 0n && isBlank(reasonCode)) {
        throw new DomainError(
          `a reason is required for a non-zero variance on input item ${planned.itemId} (PROD-004)`,
        );
      }
      resolvedInputs.push({
        itemId: planned.itemId,
        unitId: planned.unitId,
        plannedQty: formatDecimal(
          parseDecimal(planned.plannedQty, STOCK_QUANTITY_SCALE),
          STOCK_QUANTITY_SCALE,
        ),
        actualQty: formatDecimal(actualQty, STOCK_QUANTITY_SCALE),
        varianceQty: formatDecimal(varianceQty, STOCK_QUANTITY_SCALE),
        lotId: actual.lotId ?? null,
        reasonCode,
      });
    }
    for (const itemId of actualByItem.keys()) {
      if (!plannedItems.has(itemId)) {
        throw new DomainError(`unexpected input item ${itemId}: not in the recipe snapshot`);
      }
    }

    const outputLine = snapshot.outputs[0];
    if (outputLine === undefined || outputLine.itemId !== input.output.itemId) {
      throw new DomainError(
        "only the recipe version's output item may be produced; additional/by-product " +
          "outputs are undefined (open point (c))",
      );
    }

    const occurredAt = new Date(input.actualFinish);
    const drawStorageAreaId = input.inputStorageAreaId ?? null;

    const movements: PlannedMovement[] = [];
    let inputValue = 0n;
    for (const line of resolvedInputs) {
      const quantity = parseDecimal(line.actualQty, STOCK_QUANTITY_SCALE);
      if (quantity === 0n) {
        // A zero actual is a legitimate "used none"; the ledger has no zero
        // movement, so the line is recorded with a null movement_id instead.
        continue;
      }
      const balanceKey: StockBalanceKey = {
        organizationId: input.organizationId,
        itemId: line.itemId,
        locationId: batch.locationId,
        storageAreaId: drawStorageAreaId ?? "",
        lotId: line.lotId,
      };
      const balance = await tx.lockStockBalance(balanceKey, occurredAt);
      // The consumption is valued at the locked moving weighted average by
      // passing `unitCost: null`; `applyStockMovement` is the same rule the
      // ledger writer uses, so the derived input value equals the posted one.
      const posting = applyStockMovement(
        {
          quantityOnHand: balance.quantityOnHand,
          valueOnHand: balance.valueOnHand,
          avgUnitCost: balance.avgUnitCost,
        },
        { quantityDelta: formatDecimal(-quantity, STOCK_QUANTITY_SCALE), unitCost: null },
      );
      inputValue += -parseDecimal(posting.valueDelta, STOCK_VALUE_SCALE);
      movements.push({
        locationId: batch.locationId,
        storageAreaId: drawStorageAreaId ?? "",
        itemId: line.itemId,
        movementType: "production_consumption",
        quantityDelta: formatDecimal(-quantity, STOCK_QUANTITY_SCALE),
        unitCost: null,
        lotId: line.lotId,
        reasonCode: line.reasonCode,
      });
    }

    const outputValue = outputUnitCost(
      formatDecimal(inputValue, STOCK_VALUE_SCALE),
      input.output.actualQty,
    );
    movements.push({
      locationId: batch.locationId,
      storageAreaId: destination.id,
      itemId: input.output.itemId,
      movementType: "production_output",
      quantityDelta: formatDecimal(actualOutputQty, STOCK_QUANTITY_SCALE),
      unitCost: outputValue,
      lotId: input.output.lotId ?? null,
      reasonCode: null,
    });

    const results = await postStockMovements(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      sourceType: "production_batch",
      sourceId: batch.id,
      occurredAt: input.actualFinish,
      idempotencyKey,
      movements,
      ...(input.allowNegativeOverride === undefined
        ? {}
        : { allowNegativeOverride: input.allowNegativeOverride }),
    });

    const consumptionMovements = movements.length - 1;
    let movementIndex = 0;
    const movementIds: string[] = [];
    for (const line of resolvedInputs) {
      const posted = parseDecimal(line.actualQty, STOCK_QUANTITY_SCALE) === 0n;
      const movement = posted ? undefined : results[movementIndex++];
      const movementId = movement?.movementId ?? null;
      if (movementId !== null) {
        movementIds.push(movementId);
      }
      await tx.createProductionBatchInput({
        productionBatchId: batch.id,
        itemId: line.itemId,
        unitId: line.unitId,
        plannedQty: line.plannedQty,
        actualQty: line.actualQty,
        varianceQty: line.varianceQty,
        lotId: line.lotId,
        reasonCode: line.reasonCode,
        movementId,
      });
    }
    const outputMovement = results[consumptionMovements];
    if (outputMovement === undefined) {
      throw new DomainError("production output movement was not posted");
    }
    movementIds.push(outputMovement.movementId);
    const outputVariance = formatDecimal(
      actualOutputQty - parseDecimal(snapshot.plannedOutputQty, STOCK_QUANTITY_SCALE),
      STOCK_QUANTITY_SCALE,
    );
    await tx.createProductionBatchOutput({
      productionBatchId: batch.id,
      itemId: outputLine.itemId,
      unitId: outputLine.unitId,
      kind: outputLine.kind,
      plannedQty: snapshot.plannedOutputQty,
      actualQty: formatDecimal(actualOutputQty, STOCK_QUANTITY_SCALE),
      varianceQty: outputVariance,
      lotId: input.output.lotId ?? null,
      expiryDate: input.output.expiryDate ?? null,
      movementId: outputMovement.movementId,
    });

    const variancePct = yieldVariancePct(snapshot.plannedOutputQty, input.output.actualQty);
    // `DEC-080`: a yield variance is a data-quality exception, created in the
    // same transaction as the fact so a failure rolls it back with the
    // completion. The FIN tolerance thresholds are still open, so every
    // non-zero variance is recorded unconditionally (provisional, `DEC-055`
    // precedent); a zero variance records none.
    const varianceException =
      parseDecimal(variancePct, STOCK_QUANTITY_SCALE) !== 0n
        ? await tx.createDataQualityException({
            organizationId: input.organizationId,
            ruleCode: "yield_variance",
            severity: "medium",
            entityType: "production_batch",
            entityId: batch.id,
            detectedAt: input.actualFinish,
            status: "open",
            resolution: null,
            createdBy: input.actorId,
          })
        : null;
    const updated = await tx.updateProductionBatch(batch.id, {
      status: "completed",
      actualFinish: input.actualFinish,
      actualOutputQty: formatDecimal(actualOutputQty, STOCK_QUANTITY_SCALE),
      yieldVariancePct: variancePct,
    });
    if (updated === undefined) {
      throw new DomainError("production batch not found for update");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: PRODUCTION_AUDIT_ACTIONS.batchCompleted,
      entityType: "production_batch",
      entityId: batch.id,
      after: {
        actual_finish: input.actualFinish,
        actual_output_qty: formatDecimal(actualOutputQty, STOCK_QUANTITY_SCALE),
        yield_variance_pct: variancePct,
        input_value: formatDecimal(inputValue, STOCK_VALUE_SCALE),
        output_unit_cost: outputValue,
        input_count: resolvedInputs.length,
        output_count: 1,
        movement_count: results.length,
        exception_id: varianceException?.id ?? null,
      },
    });

    return {
      productionBatchId: batch.id,
      status: updated.status,
      actualOutputQty: formatDecimal(actualOutputQty, STOCK_QUANTITY_SCALE),
      yieldVariancePct: variancePct,
      inputValue: formatDecimal(inputValue, STOCK_VALUE_SCALE),
      outputUnitCost: outputValue,
      movementIds,
      inputCount: resolvedInputs.length,
      outputCount: 1,
      replayed: false,
    };
  });
}

/**
 * Rebuilds the result of an already-completed batch from its persisted lines and
 * movements, so an idempotent retry returns the original facts without writing.
 */
async function replayResult(
  tx: ProductionStore,
  organizationId: string,
  productionBatchId: string,
  actualOutputQty: string,
  yieldVariancePctValue: string | null,
): Promise<CompleteProductionBatchResult> {
  const inputs = await tx.listProductionBatchInputs({
    organizationId,
    productionBatchId,
  });
  const outputs = await tx.listProductionBatchOutputs({
    organizationId,
    productionBatchId,
  });
  let inputValue = 0n;
  const movementIds: string[] = [];
  for (const line of inputs) {
    if (line.movementId === null) {
      continue;
    }
    movementIds.push(line.movementId);
    const movement = await tx.findStockMovement(line.movementId);
    if (movement?.valueDelta != null) {
      inputValue += -parseDecimal(movement.valueDelta, STOCK_VALUE_SCALE);
    }
  }
  let outputUnitCostValue = "0.0000";
  for (const line of outputs) {
    if (line.movementId === null) {
      continue;
    }
    movementIds.push(line.movementId);
    const movement = await tx.findStockMovement(line.movementId);
    if (movement?.unitCost != null) {
      outputUnitCostValue = movement.unitCost;
    }
  }
  return {
    productionBatchId,
    status: "completed",
    actualOutputQty,
    yieldVariancePct: yieldVariancePctValue ?? "0.000000",
    inputValue: formatDecimal(inputValue, STOCK_VALUE_SCALE),
    outputUnitCost: outputUnitCostValue,
    movementIds,
    inputCount: inputs.length,
    outputCount: outputs.length,
    replayed: true,
  };
}
