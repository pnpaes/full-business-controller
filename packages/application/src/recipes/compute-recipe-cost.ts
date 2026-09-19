import {
  computeRecipeCost as computeBatchRecipeCost,
  ConversionGraph,
  convertUsingGraph,
  DomainError,
  lineCost as computeLineCost,
  Quantity,
  requiredPurchaseQuantity,
  selectEffectiveRecipeVersion,
  Unit,
  usableYieldRate,
  type UnitConversionEdge,
} from "@aquarela/domain";

import type { ConversionEdge } from "../catalog";
import {
  observationBaseUnitCost,
  selectBaseUnitCost,
  type CostObservationCost,
  type CostSourceType,
} from "./select-base-unit-cost";
import type { RawCostObservation, RecipeStore, RecipeUnit, RecipeVersionRecord } from "./types";

/** A component's cost origin: one of the DEC-047 sources, or a nested sub-recipe. */
export type RecipeComponentCostSource = CostSourceType | "sub_recipe";

export interface ComputeRecipeCostInput {
  readonly organizationId: string;
  readonly recipeVersionId: string;
  readonly asOf: Date;
  /** Defaults to `NOK` (the only Phase 1 reporting currency). */
  readonly currency?: string;
  /** Labor is slice 6; accepted here and folded into the batch output cost (§6). */
  readonly directBatchLabor?: string;
  readonly batchVariableCost?: string;
}

export interface RecipeCostComponent {
  readonly componentKind: string;
  readonly itemId: string | null;
  readonly subRecipeId: string | null;
  /** Set for a `sub_recipe` component: the effective child version actually costed. */
  readonly childRecipeVersionId: string | null;
  /** B0: quantity grossed up for the line loss factor and the recipe yield rate. */
  readonly requiredPurchaseQuantity: string;
  /** The base unit `requiredPurchaseQuantity` and `unitCost` are expressed in. */
  readonly unitId: string;
  readonly unitCost: string;
  /** B2 line cost. */
  readonly lineCost: string;
  readonly sourceType: RecipeComponentCostSource;
}

export interface ComputedRecipeCost {
  readonly recipeVersionId: string;
  readonly recipeId: string;
  readonly currency: string;
  readonly yieldRate: string;
  readonly recipeInputCost: string;
  readonly recipeOutputCost: string;
  readonly costPerUsableOutputUnit: string;
  readonly components: readonly RecipeCostComponent[];
}

interface CostingContext {
  readonly store: RecipeStore;
  readonly organizationId: string;
  readonly asOf: Date;
  readonly currency: string;
  readonly directBatchLabor?: string;
  readonly batchVariableCost?: string;
  readonly graphs: Map<string, ConversionGraph>;
}

interface VersionCost {
  readonly yieldRate: string;
  readonly components: RecipeCostComponent[];
  readonly recipeInputCost: string;
  readonly recipeOutputCost: string;
  readonly costPerUsableOutputUnit: string;
}

function toDomainUnit(unit: RecipeUnit): Unit {
  return Unit.from(unit.code, unit.dimension, unit.isBase);
}

async function graphFor(ctx: CostingContext, itemId: string | null): Promise<ConversionGraph> {
  const key = itemId ?? "";
  const cached = ctx.graphs.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const rows = await ctx.store.listEffectiveConversions(ctx.organizationId, ctx.asOf, itemId);
  const edges: UnitConversionEdge[] = rows.map((row: ConversionEdge) => ({
    from: toDomainUnit(row.fromUnit),
    to: toDomainUnit(row.toUnit),
    factor: row.factor,
    itemId: row.itemId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  }));
  const graph = ConversionGraph.from(edges);
  ctx.graphs.set(key, graph);
  return graph;
}

/** Converts a line quantity from its stored unit into the component's base unit. */
async function convertLineQuantity(
  ctx: CostingContext,
  quantity: string,
  fromUnitId: string,
  baseUnit: RecipeUnit,
  costItemId: string | null,
): Promise<string> {
  const fromRow = await ctx.store.findUnit(fromUnitId);
  if (fromRow === undefined) {
    throw new DomainError("recipe line unit not found");
  }
  const from = toDomainUnit(fromRow);
  const to = toDomainUnit(baseUnit);
  if (from.code === to.code) {
    return quantity;
  }
  const graph = await graphFor(ctx, costItemId);
  return convertUsingGraph(graph, Quantity.from(quantity, from.code), from, to, {
    asOf: ctx.asOf,
    itemId: costItemId,
  }).toString();
}

/**
 * Normalises one `cost_observation` to a base-unit cost: `pack_price / pack_size`
 * when the pack size is already in the base unit, otherwise the pack unit is
 * converted through the effective conversion graph first (§3, §12.1). A missing
 * price, size or conversion rejects the calculation rather than defaulting.
 */
async function normalizeObservation(
  ctx: CostingContext,
  observation: RawCostObservation,
  baseUnit: RecipeUnit,
  costItemId: string,
): Promise<string> {
  if (observation.packPrice === null) {
    throw new DomainError("cost observation is missing a pack price");
  }
  if (observation.packSize === null) {
    throw new DomainError("cost observation is missing a pack size");
  }
  if (observation.packUnitId === null || observation.packUnitId === baseUnit.id) {
    return observationBaseUnitCost(observation.packPrice, observation.packSize);
  }
  const packRow = await ctx.store.findUnit(observation.packUnitId);
  if (packRow === undefined) {
    throw new DomainError("cost observation pack unit not found");
  }
  const packUnit = toDomainUnit(packRow);
  const graph = await graphFor(ctx, costItemId);
  const baseUnits = convertUsingGraph(
    graph,
    Quantity.from(observation.packSize, packUnit.code),
    packUnit,
    toDomainUnit(baseUnit),
    { asOf: ctx.asOf, itemId: costItemId },
  );
  return observationBaseUnitCost(observation.packPrice, baseUnits.toString());
}

/** Resolves an item's selected base-unit cost by DEC-047 precedence. */
async function resolveItemCost(
  ctx: CostingContext,
  itemId: string,
  baseUnit: RecipeUnit,
  currentCost: string | null,
): Promise<{ cost: string; sourceType: CostSourceType }> {
  const supplierPrices = (
    await ctx.store.listEffectiveSupplierPrices(ctx.organizationId, itemId, ctx.asOf)
  ).map((candidate) => ({ cost: candidate.cost, effectiveFrom: candidate.effectiveFrom }));

  const observations: CostObservationCost[] = [];
  for (const observation of await ctx.store.listCostObservations(
    ctx.organizationId,
    itemId,
    ctx.asOf,
  )) {
    observations.push({
      cost: await normalizeObservation(ctx, observation, baseUnit, itemId),
      observedAt: observation.observedAt,
    });
  }

  return selectBaseUnitCost({ supplierPrices, observations, currentCost }, ctx.currency);
}

async function costVersion(
  ctx: CostingContext,
  version: RecipeVersionRecord,
  path: ReadonlySet<string>,
  includeBatchCosts: boolean,
): Promise<VersionCost> {
  const yieldRate = usableYieldRate(version.plannedInputQty, version.approvedUsableOutput);
  const lines = await ctx.store.listRecipeLines(version.id);
  const components: RecipeCostComponent[] = [];

  for (const line of lines) {
    if (line.componentKind === "sub_recipe") {
      const childRecipe = await ctx.store.findRecipe(line.subRecipeId!);
      if (childRecipe === undefined || childRecipe.organizationId !== ctx.organizationId) {
        throw new DomainError("sub-recipe not found in organization");
      }
      if (path.has(childRecipe.id)) {
        throw new DomainError("circular sub-recipes are prohibited (COST-002)");
      }
      if (childRecipe.outputItemId === null) {
        throw new DomainError("a sub-recipe must produce an intermediate item (DEC-030)");
      }
      const childVersion = selectEffectiveRecipeVersion(
        (await ctx.store.listRecipeVersions(childRecipe.id)).filter(
          (candidate) => candidate.state === "approved",
        ),
        ctx.asOf,
      );
      if (childVersion === undefined) {
        throw new DomainError(
          "sub-recipe has no approved version effective at the requested date (COST-002)",
        );
      }
      const childItem = await ctx.store.findItem(childRecipe.outputItemId);
      if (childItem === undefined) {
        throw new DomainError("sub-recipe output item not found");
      }
      const childBaseUnit = await ctx.store.findUnit(childItem.baseUnitId);
      if (childBaseUnit === undefined) {
        throw new DomainError("sub-recipe output base unit not found");
      }

      const child = await costVersion(ctx, childVersion, new Set([...path, childRecipe.id]), false);
      const converted = await convertLineQuantity(
        ctx,
        line.quantity,
        line.unitId,
        childBaseUnit,
        childItem.id,
      );
      const required = requiredPurchaseQuantity(converted, line.lossFactor, yieldRate);
      const cost = computeLineCost(required, child.costPerUsableOutputUnit, ctx.currency);
      components.push({
        componentKind: line.componentKind,
        itemId: null,
        subRecipeId: childRecipe.id,
        childRecipeVersionId: childVersion.id,
        requiredPurchaseQuantity: required,
        unitId: childBaseUnit.id,
        unitCost: child.costPerUsableOutputUnit,
        lineCost: cost,
        sourceType: "sub_recipe",
      });
    } else {
      const item = await ctx.store.findItem(line.itemId!);
      if (item === undefined || item.organizationId !== ctx.organizationId) {
        throw new DomainError("recipe line item not found in organization");
      }
      const baseUnit = await ctx.store.findUnit(item.baseUnitId);
      if (baseUnit === undefined) {
        throw new DomainError("recipe line item base unit not found");
      }
      const converted = await convertLineQuantity(
        ctx,
        line.quantity,
        line.unitId,
        baseUnit,
        item.id,
      );
      const required = requiredPurchaseQuantity(converted, line.lossFactor, yieldRate);
      const selection = await resolveItemCost(ctx, item.id, baseUnit, item.currentCost);
      const cost = computeLineCost(required, selection.cost, ctx.currency);
      components.push({
        componentKind: line.componentKind,
        itemId: item.id,
        subRecipeId: null,
        childRecipeVersionId: null,
        requiredPurchaseQuantity: required,
        unitId: baseUnit.id,
        unitCost: selection.cost,
        lineCost: cost,
        sourceType: selection.sourceType,
      });
    }
  }

  const batchInput = {
    currency: ctx.currency,
    lines: components.map((component) => ({ lineCost: component.lineCost })),
    approvedUsableOutput: version.approvedUsableOutput,
    ...(includeBatchCosts && ctx.directBatchLabor !== undefined
      ? { directBatchLabor: ctx.directBatchLabor }
      : {}),
    ...(includeBatchCosts && ctx.batchVariableCost !== undefined
      ? { batchVariableCost: ctx.batchVariableCost }
      : {}),
  };
  const totals = computeBatchRecipeCost(batchInput);
  return { yieldRate, components, ...totals };
}

/**
 * Computes a recipe version's cost and yield (CALCULATION_CONTRACT §6): converts
 * each line to its component's base unit, grosses the quantity up for the line
 * loss factor and the recipe yield rate (B0), multiplies by the DEC-047-selected
 * base-unit cost (B2), sums bottom-up through sub-recipes, and divides by the
 * approved usable output (B3).
 *
 * Sub-recipe dependencies must have an approved version effective at `asOf`
 * (COST-002); a cycle is rejected defensively even though registration prevents
 * one. The version's stored `yield_rate` is **not** read: the rate is re-derived
 * from `approved_usable_output / planned_input` so the cost uses the same value
 * §6 defines.
 */
export async function computeRecipeCost(
  store: RecipeStore,
  input: ComputeRecipeCostInput,
): Promise<ComputedRecipeCost> {
  const currency = input.currency ?? "NOK";
  const ctx: CostingContext = {
    store,
    organizationId: input.organizationId,
    asOf: input.asOf,
    currency,
    graphs: new Map<string, ConversionGraph>(),
    ...(input.directBatchLabor !== undefined ? { directBatchLabor: input.directBatchLabor } : {}),
    ...(input.batchVariableCost !== undefined
      ? { batchVariableCost: input.batchVariableCost }
      : {}),
  };

  const version = await store.findRecipeVersion(input.recipeVersionId);
  if (version === undefined) {
    throw new DomainError("recipe version not found");
  }
  const recipe = await store.findRecipe(version.recipeId);
  if (recipe === undefined || recipe.organizationId !== input.organizationId) {
    throw new DomainError("recipe not found in organization");
  }

  const result = await costVersion(ctx, version, new Set([recipe.id]), true);
  return {
    recipeVersionId: version.id,
    recipeId: recipe.id,
    currency,
    ...result,
  };
}
