import {
  ConversionGraph,
  convertUsingGraph,
  DomainError,
  Quantity,
  Unit,
  scaleQuantityByRatio,
  type UnitConversionEdge,
} from "@aquarela/domain";

import type { MasterUnit } from "../catalog";
import type { ProductionRecipeVersionRecord, ProductionStore } from "./types";

/**
 * Materialises a batch's **planned** input/output snapshot from an approved
 * recipe version (`PROD-001`, `DEC-031`; CALCULATION_CONTRACT §6).
 *
 * Every recipe component is resolved to a stocked target item:
 *
 * - an `ingredient`/`packaging` line's own `itemId`;
 * - a `sub_recipe` line's child recipe output item (`DEC-030`/`DEC-005`) — a
 *   sub-recipe has no item of its own.
 *
 * The line quantity is converted from the recipe line's unit into the target
 * item's base unit through the same effective-dated `ConversionGraph` costing
 * uses (`compute-recipe-cost.ts`), because the ledger posts base-unit quantities
 * (`postStockMovement`). The output is the recipe's output item at
 * `version.plannedOutputQty` (`recipe_version` quantities are treated as the
 * output item's base unit — slice-5 convention).
 *
 * Only **one** planned output line is produced: the schema permits several
 * output kinds, but the cost allocation across multiple outputs is undefined
 * (open point (c), `schema/production.ts`), so a batch is a single-output
 * operation here. Multi-output is deliberately not invented.
 *
 * Also carries the base-unit conversion helper the completion command reuses for
 * actual quantities.
 */

export interface PlannedInputLine {
  readonly itemId: string;
  readonly unitId: string;
  /** numeric(19,6), in the item base unit. */
  readonly plannedQty: string;
}

export interface PlannedOutputLine {
  readonly itemId: string;
  readonly unitId: string;
  readonly kind: string;
  /** numeric(19,6), in the item base unit. */
  readonly plannedQty: string;
}

export interface PlannedSnapshot {
  readonly recipeId: string;
  readonly outputItemId: string;
  /** numeric(19,6). */
  readonly plannedOutputQty: string;
  readonly inputs: readonly PlannedInputLine[];
  readonly outputs: readonly PlannedOutputLine[];
}

/** The single supported output kind (open point (c): no multi-output allocation). */
const FINISHED_OUTPUT_KIND = "finished";

function toDomainUnit(unit: MasterUnit): Unit {
  return Unit.from(unit.code, unit.dimension, unit.isBase);
}

/**
 * Converts a quantity from `fromUnit` to `toUnit` through the effective-dated
 * conversion graph (`FND-003`, `compute-recipe-cost.ts`). Same-code units pass
 * through unchanged; a missing path rejects rather than defaulting (§12.1).
 */
export async function convertToBaseUnit(
  store: ProductionStore,
  input: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly quantity: string;
    readonly fromUnit: MasterUnit;
    readonly toUnit: MasterUnit;
    readonly itemId: string;
  },
): Promise<string> {
  if (input.fromUnit.code === input.toUnit.code) {
    return input.quantity;
  }
  const edges: UnitConversionEdge[] = (
    await store.listEffectiveConversions(input.organizationId, input.asOf, input.itemId)
  ).map((row) => ({
    from: toDomainUnit(row.fromUnit),
    to: toDomainUnit(row.toUnit),
    factor: row.factor,
    itemId: row.itemId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  }));
  const graph = ConversionGraph.from(edges);
  return convertUsingGraph(
    graph,
    Quantity.from(input.quantity, input.fromUnit.code),
    toDomainUnit(input.fromUnit),
    toDomainUnit(input.toUnit),
    { asOf: input.asOf, itemId: input.itemId },
  ).toString();
}

async function requireMasterUnit(
  store: ProductionStore,
  unitId: string,
  message: string,
): Promise<MasterUnit> {
  const unit = await store.findMasterUnit(unitId);
  if (unit === undefined) {
    throw new DomainError(message);
  }
  return unit;
}

/** Resolves and organization-checks the target item of one recipe component line. */
async function resolveComponentItem(
  store: ProductionStore,
  organizationId: string,
  line: { readonly itemId: string | null; readonly subRecipeId: string | null },
): Promise<string> {
  if (line.itemId !== null) {
    const item = await store.findItem(line.itemId);
    if (item === undefined || item.organizationId !== organizationId) {
      throw new DomainError("recipe line item not found in organization");
    }
    if (item.inventoryPolicy !== "stocked") {
      throw new DomainError("a production input item must hold stock");
    }
    return item.id;
  }
  if (line.subRecipeId === null) {
    throw new DomainError("a recipe line must reference an item or a sub-recipe");
  }
  const subRecipe = await store.findRecipe(line.subRecipeId);
  if (subRecipe === undefined || subRecipe.organizationId !== organizationId) {
    throw new DomainError("sub-recipe not found in organization");
  }
  if (subRecipe.outputItemId === null) {
    throw new DomainError("a sub-recipe must produce an intermediate item (DEC-030)");
  }
  const item = await store.findItem(subRecipe.outputItemId);
  if (item === undefined || item.organizationId !== organizationId) {
    throw new DomainError("sub-recipe output item not found in organization");
  }
  if (item.inventoryPolicy !== "stocked") {
    throw new DomainError("a production input item must hold stock");
  }
  return item.id;
}

/**
 * Builds the planned snapshot for an approved recipe version at `asOf`. The
 * caller must already have validated the version's `approved` state
 * (`PROD-001`); this only materialises quantities.
 */
export async function resolvePlannedSnapshot(
  store: ProductionStore,
  input: {
    readonly organizationId: string;
    readonly version: ProductionRecipeVersionRecord;
    readonly asOf: Date;
  },
): Promise<PlannedSnapshot> {
  const recipe = await store.findRecipe(input.version.recipeId);
  if (recipe === undefined || recipe.organizationId !== input.organizationId) {
    throw new DomainError("recipe not found in organization");
  }
  if (recipe.outputItemId === null) {
    throw new DomainError("a production recipe must produce an item (PROD-001)");
  }
  const outputItem = await store.findItem(recipe.outputItemId);
  if (outputItem === undefined || outputItem.organizationId !== input.organizationId) {
    throw new DomainError("recipe output item not found in organization");
  }
  if (outputItem.inventoryPolicy !== "stocked") {
    throw new DomainError("a production output item must hold stock");
  }
  await requireMasterUnit(store, outputItem.baseUnitId, "recipe output base unit not found");

  const lines = await store.listRecipeLines(input.version.id);
  const inputs: PlannedInputLine[] = [];
  for (const line of lines) {
    const itemId = await resolveComponentItem(store, input.organizationId, line);
    const item = await store.findItem(itemId);
    if (item === undefined) {
      throw new DomainError("recipe line item not found in organization");
    }
    const baseUnit = await requireMasterUnit(
      store,
      item.baseUnitId,
      "recipe line item base unit not found",
    );
    const fromUnit = await requireMasterUnit(store, line.unitId, "recipe line unit not found");
    const plannedQty = await convertToBaseUnit(store, {
      organizationId: input.organizationId,
      asOf: input.asOf,
      quantity: line.quantity,
      fromUnit,
      toUnit: baseUnit,
      itemId,
    });
    inputs.push({ itemId, unitId: item.baseUnitId, plannedQty });
  }

  return {
    recipeId: recipe.id,
    outputItemId: outputItem.id,
    plannedOutputQty: input.version.plannedOutputQty,
    inputs,
    outputs: [
      {
        itemId: outputItem.id,
        unitId: outputItem.baseUnitId,
        kind: FINISHED_OUTPUT_KIND,
        plannedQty: input.version.plannedOutputQty,
      },
    ],
  };
}

/**
 * Scales a planned snapshot to a batch's intended output quantity (`DEC-125`):
 * every planned quantity is multiplied by `plannedQty / snapshot.plannedOutputQty`
 * and rounded **once** at B0 (6 dp, HALF_UP) through `scaleQuantityByRatio` —
 * never at intermediate algebra. The scaled planned output is exactly
 * `plannedQty`, and the recipe version's single-batch quantities are unchanged
 * when `plannedQty` equals `snapshot.plannedOutputQty`. `plannedQty` must be
 * positive (the caller validates it); the version's `planned_output_qty` is
 * positive by schema check.
 */
export function scalePlannedSnapshot(
  snapshot: PlannedSnapshot,
  plannedQty: string,
): PlannedSnapshot {
  const denominator = snapshot.plannedOutputQty;
  return {
    ...snapshot,
    plannedOutputQty: scaleQuantityByRatio(snapshot.plannedOutputQty, plannedQty, denominator),
    inputs: snapshot.inputs.map((line) => ({
      ...line,
      plannedQty: scaleQuantityByRatio(line.plannedQty, plannedQty, denominator),
    })),
    outputs: snapshot.outputs.map((line) => ({
      ...line,
      plannedQty: scaleQuantityByRatio(line.plannedQty, plannedQty, denominator),
    })),
  };
}
