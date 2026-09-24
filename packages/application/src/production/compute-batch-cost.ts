import {
  applyProductiveHoursPct,
  directLaborCost,
  DomainError,
  formatDecimal,
  lineCost,
  MONEY_SCALE,
  outputUnitCost,
  parseDecimal,
  QUANTITY_SCALE,
} from "@aquarela/domain";

import { resolveAllocatedUnitOverhead } from "../costing/resolve-allocated-unit-overhead";
import { computeRecipeCost } from "../recipes/compute-recipe-cost";

import type { ProductionBatchCostStore } from "./types";

/**
 * `DEC-124` — the realistic batch cost, computed on read (no cost column, no
 * schema change). The batch must be `completed`; the actuals are the facts the
 * ledger already holds.
 *
 * ```
 * ingredientCost            = Σ abs(value_delta) over the batch's production_consumption movements   # 4 dp
 * effectiveLoadedHourlyRate = effective labor_rate(version.labor_cost_center_id, version.labor_role_code)
 *                             with productive_hours_pct applied (DEC-112/DEC-055), else null
 * labourCost                = round(actual_labour_hours × effectiveLoadedHourlyRate, 4 dp)            # B-money
 * allocatedOverhead         = per-unit allocation × actualOutputQty, or 0 with a note                 # B2
 * totalBatchCost            = ingredientCost + labourCost + allocatedOverhead                          # 4 dp
 * unitCost                  = round(totalBatchCost / actualOutputQty, 4 dp)                            # B3
 * theoreticalUnitCost       = computeRecipeCost(asOf = actual_finish).costPerUsableOutputUnit          # B3
 * varianceUnitCost          = theoreticalUnitCost − unitCost                                           # 4 dp
 * ```
 *
 * Decimal only, `HALF_UP`, never rounded at intermediate algebra
 * (`CALCULATION_CONTRACT.md` B0–B4, `DEC-024`). The sum of the three 4 dp
 * components is exact (no boundary crossed); the only divisions are the B3
 * `outputUnitCost` and the B2 `lineCost` overhead product, each rounding once.
 *
 * Fail-closed (`DEC-114`): a production/time overhead denominator still throws
 * inside `resolveAllocatedUnitOverhead` rather than inventing a basis; a missing
 * rule or a missing pool reports zero overhead with a provenance note.
 */
export interface ComputeProductionBatchCostQuery {
  readonly organizationId: string;
  readonly productionBatchId: string;
  /** When supplied, the per-unit allocation of this pool is charged to the output. */
  readonly costPoolId?: string | null;
  /** Optional allocation period (ISO instants); defaults to the month containing `actual_finish`. */
  readonly periodFrom?: string | null;
  readonly periodTo?: string | null;
}

export interface ProductionBatchCost {
  readonly productionBatchId: string;
  readonly currency: string;
  /** numeric(19,4). */
  readonly ingredientCost: string;
  readonly labourCost: string;
  readonly allocatedOverhead: string;
  readonly totalBatchCost: string;
  /** numeric(19,6). */
  readonly actualOutputQty: string;
  /** B3: numeric(19,4). */
  readonly unitCost: string;
  readonly plannedOutputQty: string | null;
  /** numeric(9,6) signed fraction read from the header, not ×100. */
  readonly yieldVariancePct: string | null;
  /** numeric(9,2) hours, "0.00" when none were recorded. */
  readonly actualHours: string;
  /** 2 dp loaded per-productive-hour rate; null when the version has no labour mapping/rate. */
  readonly effectiveLoadedHourlyRate: string | null;
  /** B3 per approved usable output unit; null when the recipe cost cannot be resolved. */
  readonly theoreticalUnitCost: string | null;
  /** theoretical − actual at 4 dp; null when the theoretical cost is unavailable. */
  readonly varianceUnitCost: string | null;
  readonly provenance: readonly string[];
}

/** `production_batch.actual_labour_hours` is `numeric(9,2)` (hours convention). */
const HOURS_SCALE = 2;
/** `directLaborCost` takes minutes at quantity scale; hours → minutes is `× 60`. */
const MINUTES_PER_HOUR_SCALED = 600_000n;
const DEFAULT_CURRENCY = "NOK";

export async function computeProductionBatchCost(
  store: ProductionBatchCostStore,
  query: ComputeProductionBatchCostQuery,
): Promise<ProductionBatchCost> {
  const batch = await store.findProductionBatch({
    organizationId: query.organizationId,
    productionBatchId: query.productionBatchId,
  });
  if (batch === undefined) {
    throw new DomainError("production batch not found in organization");
  }
  if (batch.status !== "completed") {
    throw new DomainError(
      `a batch cost is only available for a completed batch (current: ${batch.status})`,
    );
  }
  if (batch.actualFinish === null) {
    throw new DomainError("a completed batch must have an actual finish to cost");
  }
  const actualOutputQty = batch.actualOutputQty;
  if (actualOutputQty === null) {
    throw new DomainError("a completed batch must have an actual output quantity to cost");
  }
  if (parseDecimal(actualOutputQty, QUANTITY_SCALE) <= 0n) {
    throw new DomainError("actual output quantity must be positive to derive a unit cost");
  }

  const finish = new Date(batch.actualFinish);
  const provenance: string[] = [];

  // 1. Ingredient cost — the actual moving-average value the ledger already holds.
  const movements = await store.listStockMovements({
    organizationId: query.organizationId,
    sourceType: "production_batch",
    sourceId: batch.id,
  });
  let ingredientScaled = 0n;
  for (const movement of movements) {
    if (movement.movementType !== "production_consumption") {
      continue;
    }
    const value =
      movement.valueDelta === null ? 0n : parseDecimal(movement.valueDelta, MONEY_SCALE);
    ingredientScaled += value < 0n ? -value : value;
  }
  const ingredientCost = formatDecimal(ingredientScaled, MONEY_SCALE);
  provenance.push(
    "ingredient cost = Σ abs(value_delta) of the batch's production_consumption movements " +
      "(the locked moving weighted average, 4 dp)",
  );

  // 2. Labour — actual hours × the effective loaded rate for the version's mapping.
  const version = await store.findRecipeVersion(batch.recipeVersionId);
  if (version === undefined) {
    throw new DomainError("recipe version not found");
  }
  let effectiveLoadedHourlyRate: string | null = null;
  if (version.laborCostCenterId === null || version.laborRoleCode === null) {
    provenance.push(
      "no labour mapping on the recipe version (labor_cost_center_id / labor_role_code): " +
        "labour cost is zero",
    );
  } else {
    const rate = await store.findEffectiveLaborRate({
      organizationId: query.organizationId,
      costCenterId: version.laborCostCenterId,
      roleCode: version.laborRoleCode,
      asOf: finish,
    });
    if (rate === undefined) {
      provenance.push(
        "no effective labour rate for the recipe version's cost centre/role at the finish " +
          "instant: labour cost is zero",
      );
    } else {
      effectiveLoadedHourlyRate =
        rate.productiveHoursPct === null
          ? rate.loadedHourlyRate
          : applyProductiveHoursPct(rate.loadedHourlyRate, rate.productiveHoursPct);
      provenance.push(
        "labour cost = actual_labour_hours × the effective loaded hourly rate (DEC-112), with " +
          "productive_hours_pct applied (DEC-055)",
      );
    }
  }

  const hoursScaled = parseDecimal(batch.actualLabourHours ?? "0", HOURS_SCALE);
  const actualHours = formatDecimal(hoursScaled, HOURS_SCALE);
  const labourCost =
    effectiveLoadedHourlyRate === null
      ? formatDecimal(0n, MONEY_SCALE)
      : directLaborCost(
          formatDecimal(hoursScaled * MINUTES_PER_HOUR_SCALED, QUANTITY_SCALE),
          effectiveLoadedHourlyRate,
        );

  // 3. Theoretical unit cost (recipe at the actual finish) — also the currency.
  let currency = DEFAULT_CURRENCY;
  let theoreticalUnitCost: string | null = null;
  try {
    const theoretical = await computeRecipeCost(store, {
      organizationId: query.organizationId,
      recipeVersionId: batch.recipeVersionId,
      asOf: finish,
    });
    currency = theoretical.currency;
    theoreticalUnitCost = theoretical.costPerUsableOutputUnit;
  } catch (error) {
    if (!(error instanceof DomainError)) {
      throw error;
    }
    provenance.push(`theoretical recipe cost unavailable: ${error.message}`);
  }

  // 4. Allocated overhead — the pool's per-unit allocation × actual output.
  let allocatedOverhead = formatDecimal(0n, MONEY_SCALE);
  if (query.costPoolId === undefined || query.costPoolId === null) {
    provenance.push("no cost pool supplied: allocated overhead is zero");
  } else {
    const overhead = await resolveAllocatedUnitOverhead(store, {
      organizationId: query.organizationId,
      costPoolId: query.costPoolId,
      locationId: batch.locationId,
      asOf: finish,
      ...(query.periodFrom === undefined || query.periodFrom === null
        ? {}
        : { periodFrom: new Date(query.periodFrom) }),
      ...(query.periodTo === undefined || query.periodTo === null
        ? {}
        : { periodTo: new Date(query.periodTo) }),
    });
    if (overhead === undefined) {
      provenance.push(
        `no effective allocation rule for cost pool ${query.costPoolId} at the finish instant: ` +
          "allocated overhead is zero",
      );
    } else {
      allocatedOverhead = lineCost(actualOutputQty, overhead.perUnitOverhead, currency);
      provenance.push(
        `allocated overhead = per-unit allocation (${overhead.perUnitOverhead} per ` +
          `${overhead.denominatorSource} driver unit) × actual output`,
      );
    }
  }

  // 5. Totals. The three 4 dp components sum exactly (no boundary crossed).
  const totalBatchCost = formatDecimal(
    parseDecimal(ingredientCost, MONEY_SCALE) +
      parseDecimal(labourCost, MONEY_SCALE) +
      parseDecimal(allocatedOverhead, MONEY_SCALE),
    MONEY_SCALE,
  );
  const unitCost = outputUnitCost(totalBatchCost, actualOutputQty);
  const varianceUnitCost =
    theoreticalUnitCost === null
      ? null
      : formatDecimal(
          parseDecimal(theoreticalUnitCost, MONEY_SCALE) - parseDecimal(unitCost, MONEY_SCALE),
          MONEY_SCALE,
        );

  return {
    productionBatchId: batch.id,
    currency,
    ingredientCost,
    labourCost,
    allocatedOverhead,
    totalBatchCost,
    actualOutputQty: formatDecimal(parseDecimal(actualOutputQty, QUANTITY_SCALE), QUANTITY_SCALE),
    unitCost,
    plannedOutputQty: batch.plannedOutputQty,
    yieldVariancePct: batch.yieldVariancePct,
    actualHours,
    effectiveLoadedHourlyRate,
    theoreticalUnitCost,
    varianceUnitCost,
    provenance,
  };
}
