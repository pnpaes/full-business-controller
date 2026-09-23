import {
  computeRecipeCost as computeOutputUnitCost,
  DomainError,
  formatDecimal,
  MONEY_SCALE,
  normalizeCurrency,
  parseDecimal,
  QUANTITY_SCALE,
  type CostCardCompositionInput,
} from "@aquarela/domain";

import { computeRecipeCost, type RecipeCostComponent } from "../recipes/compute-recipe-cost";
import type { RecipeStore } from "../recipes/types";

import type { CostCardComponentInput } from "./cost-card";
import type { PriceVersionRecord } from "./price-scenario-types";
import { resolveAllocatedUnitOverhead } from "./resolve-allocated-unit-overhead";
import { resolveChannelVariableCost } from "./resolve-channel-variable-cost";
import { resolveDirectLaborCost } from "./resolve-direct-labor-cost";
import type {
  AllocationRuleRecord,
  ChannelFeeRuleRecord,
  LaborRateRecord,
  OperatingCostRecord,
} from "./types";

/**
 * Assembles a `CostCardCompositionInput` for `calculateCostCard` from the reads
 * that already exist, per `DEC-111`. It assembles **only** what the canonical
 * facts produce — the effective recipe assignment, `computeRecipeCost` and the
 * effective price version — and takes the four costs that have no resolver
 * (direct labour, channel variable, other variable, allocated overhead) as
 * explicit validated command inputs, recording provenance. It invents no policy
 * and performs no maths of its own: every boundary (B2, B3) is crossed inside
 * `@aquarela/domain` (`ADR-0007`).
 *
 * ```
 * ingredientCost  = Σ(ingredient + sub_recipe line_cost) / approved_usable_output   # B3
 * packagingCost   = Σ(packaging line_cost) / approved_usable_output                 # B3
 * unitNetSales    = effective price_version.netPrice
 * ```
 */

/** The default for each explicit component input (a money string at 4 dp). */
const SUPPLIED_COMPONENT_DEFAULT = "0.0000";

/**
 * The store the assembler needs: the recipe port (assignment resolution +
 * `computeRecipeCost`) plus the effective price-version read. Composed by
 * `createPostgresCostCardCompositionStore`.
 */
export interface CostCardCompositionStore extends RecipeStore {
  /** The one version effective for a scope at `asOf` (half-open window), if any. */
  findEffectivePriceVersion(query: {
    readonly organizationId: string;
    readonly productVariantId: string;
    readonly locationId: string | null;
    readonly channelId: string | null;
    readonly asOf: Date;
  }): Promise<PriceVersionRecord | undefined>;
}

/**
 * The assembler's store once the `DEC-112` component resolvers are wired in: the
 * composition port plus the four costing reads the resolvers need. Composed by
 * `createPostgresCostCardCompositionStore`.
 */
export interface CostCardComponentStore extends CostCardCompositionStore {
  findEffectiveLaborRate(query: {
    readonly organizationId: string;
    readonly costCenterId: string;
    readonly roleCode: string;
    readonly asOf: Date;
  }): Promise<LaborRateRecord | undefined>;
  listEffectiveChannelFeeRules(query: {
    readonly organizationId: string;
    readonly channelId: string;
    readonly asOf: Date;
  }): Promise<readonly ChannelFeeRuleRecord[]>;
  listEffectiveOperatingCosts(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly costPoolId?: string | null;
  }): Promise<readonly OperatingCostRecord[]>;
  listEffectiveAllocationRules(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly costPoolId?: string;
  }): Promise<readonly AllocationRuleRecord[]>;
  countEligibleProducts(query: {
    readonly organizationId: string;
    readonly locationId: string;
    readonly asOf: Date;
  }): Promise<number>;
  /** `DEC-114`: the half-open `[from, to)` period sales volume for one location. */
  sumSalesVolume(query: {
    readonly organizationId: string;
    readonly locationId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<{ readonly revenue: string; readonly transactions: string; readonly units: string }>;
}

export interface AssembleCostCardCompositionInput {
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly locationId: string;
  readonly channelId?: string | null;
  /**
   * Optional optimistic guard: when supplied it must equal the version the
   * effective assignment resolves to, or the assembly is rejected.
   */
  readonly recipeVersionId?: string | null;
  readonly asOf: Date;
  /** Defaults to `NOK` (the only Phase 1 reporting currency). */
  readonly currency?: string;
  /** Explicit command inputs (DEC-111); each defaults to `"0.0000"`. */
  readonly directLaborCost?: string;
  readonly channelVariableCost?: string;
  readonly otherVariableCost?: string;
  readonly allocatedUnitOverhead?: string;
  /**
   * `DEC-112` resolver inputs. A resolved component wins over its explicit
   * input above; the provenance records which was used.
   */
  readonly costPoolId?: string | null;
  /** Units per order for a fixed per-order channel fee; defaults to `"1"`. */
  readonly unitsPerOrder?: string;
  /**
   * The overhead allocation period (default: the UTC month containing `asOf`).
   * Accepts an ISO instant or a parsed `Date`; an invalid value is rejected.
   */
  readonly periodFrom?: Date | string;
  readonly periodTo?: Date | string;
  readonly taxRuleSnapshot?: Record<string, unknown>;
  readonly fxRateId?: string | null;
  readonly roundingScales?: Record<string, unknown>;
}

/** Which components a `DEC-112` resolver produced rather than the caller. */
export interface CostCardResolvedComponents {
  readonly directLaborCost: boolean;
  readonly channelVariableCost: boolean;
  readonly allocatedUnitOverhead: boolean;
}

/** Which composition parts were assembled from reads vs supplied by the caller. */
export interface CostCardCompositionProvenance {
  readonly recipeVersionId: string;
  readonly approvedUsableOutput: string;
  readonly priceVersionId: string;
  readonly assembled: {
    readonly ingredientCost: string;
    readonly packagingCost: string;
    readonly unitNetSales: string;
  };
  /** The **effective** component values used (resolved where a resolver won). */
  readonly supplied: {
    readonly directLaborCost: string;
    readonly channelVariableCost: string;
    readonly otherVariableCost: string;
    readonly allocatedUnitOverhead: string;
  };
  /** Which components a `DEC-112` resolver produced rather than the caller. */
  readonly resolved: CostCardResolvedComponents;
  readonly notes: readonly string[];
}

export interface AssembleCostCardCompositionResult {
  readonly composition: CostCardCompositionInput;
  /** The snapshot components: the recipe lines (B2) plus the supplied inputs. */
  readonly components: readonly CostCardComponentInput[];
  /** The version the effective assignment resolved to (store on the cost card). */
  readonly recipeVersionId: string;
  /** Snapshot options echoed for `calculateCostCard` from the same request. */
  readonly snapshotOptions: CostCardSnapshotOptions;
  readonly provenance: CostCardCompositionProvenance;
}

/** Optional calculation-snapshot metadata (`CALCULATION_CONTRACT` §11). */
export interface CostCardSnapshotOptions {
  readonly taxRuleSnapshot?: Record<string, unknown>;
  readonly fxRateId?: string | null;
  readonly roundingScales?: Record<string, unknown>;
}

/**
 * `snapshot_component.component_kind` has no `sub_recipe` value, so a sub-recipe
 * line is recorded as an ingredient-bucket `ingredient` component and labelled
 * `sub_recipe` in its provenance (DEC-111).
 */
const RECIPE_COMPONENT_SNAPSHOT_KIND: Readonly<Record<string, string>> = {
  ingredient: "ingredient",
  packaging: "packaging",
  sub_recipe: "ingredient",
};

/** Fails closed on a `recipe_line.component_kind` outside the known vocabulary. */
function recipeComponentSnapshotKind(componentKind: string): string {
  const snapshotKind = RECIPE_COMPONENT_SNAPSHOT_KIND[componentKind];
  if (snapshotKind === undefined) {
    throw new DomainError(`unknown recipe componentKind "${componentKind}"`);
  }
  return snapshotKind;
}

/**
 * `CALCULATION_CONTRACT` §6 stores a recipe line's values at different
 * boundaries: the quantity at B0, the line-cost `amount` at B2, and a
 * sub-recipe's `unitCost` (the child's per-unit cost) at B3. A
 * `snapshot_component` row carries one `roundingBoundary`, so it records the
 * boundary of the row's cost — B3 for a sub-recipe line, B2 for every other
 * line — while the per-field boundaries are echoed in
 * `provenance.roundingBoundaries` so the B0 quantity is not mislabelled B2.
 */
function recipeComponentRoundingBoundary(component: RecipeCostComponent): string {
  return component.sourceType === "sub_recipe" ? "B3" : "B2";
}

/** The explicit inputs, in the order they are emitted as snapshot components. */
const SUPPLIED_COMPONENT_KINDS = [
  ["directLaborCost", "direct_labor"],
  ["channelVariableCost", "channel_variable"],
  ["otherVariableCost", "other_variable"],
  ["allocatedUnitOverhead", "allocated_overhead"],
] as const;

type SuppliedComponentField = (typeof SUPPLIED_COMPONENT_KINDS)[number][0];

/**
 * The snapshot provenance `sourceType` for each component: the `DEC-112`
 * resolver that produced it when resolved, else the caller's explicit input.
 * `other_variable` has no resolver, so it is always `command_input`.
 */
function componentSourceType(
  field: SuppliedComponentField,
  resolved: CostCardResolvedComponents,
): string {
  switch (field) {
    case "directLaborCost":
      return resolved.directLaborCost ? "recipe_labour_rule" : "command_input";
    case "channelVariableCost":
      return resolved.channelVariableCost ? "channel_fee_rule" : "command_input";
    case "allocatedUnitOverhead":
      return resolved.allocatedUnitOverhead ? "operating_cost_pool" : "command_input";
    default:
      return "command_input";
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new DomainError(`${field} must not be empty`);
  }
}

function assertValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DomainError(`${field} must be a valid Date`);
  }
}

/** Parses an optional ISO instant (or accepts a `Date`); rejects an invalid value. */
function parseOptionalInstant(value: Date | string | undefined, field: string): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError(`${field} must be an ISO-8601 instant`);
  }
  return parsed;
}

/** Parses one explicit money input, defaulting to `"0.0000"` and canonicalising. */
function readSuppliedMoney(value: string | undefined, field: string): string {
  if (value === undefined) {
    return SUPPLIED_COMPONENT_DEFAULT;
  }
  const parsed = parseDecimal(value, MONEY_SCALE);
  if (parsed < 0n) {
    throw new DomainError(`${field} must not be negative`);
  }
  return formatDecimal(parsed, MONEY_SCALE);
}

/**
 * A bucket's per-unit cost at B3, delegated to the domain recipe primitive (which
 * owns the `Σ line_cost / approved_usable_output` boundary) rather than a local
 * division.
 */
function bucketCostPerUnit(
  currency: string,
  components: readonly RecipeCostComponent[],
  kinds: readonly string[],
  approvedUsableOutput: string,
): string {
  const lines = components
    .filter((component) => kinds.includes(component.componentKind))
    .map((component) => ({ lineCost: component.lineCost }));
  return computeOutputUnitCost({ currency, lines, approvedUsableOutput }).costPerUsableOutputUnit;
}

function buildComponents(
  recipeComponents: readonly RecipeCostComponent[],
  supplied: CostCardCompositionProvenance["supplied"],
  resolved: CostCardResolvedComponents,
): CostCardComponentInput[] {
  const components: CostCardComponentInput[] = recipeComponents.map((component) => ({
    componentKind: recipeComponentSnapshotKind(component.componentKind),
    itemId: component.itemId,
    quantity: component.requiredPurchaseQuantity,
    unitId: component.unitId,
    unitCost: component.unitCost,
    amount: component.lineCost,
    roundingBoundary: recipeComponentRoundingBoundary(component),
    provenance: {
      sourceType: component.sourceType,
      childRecipeVersionId: component.childRecipeVersionId,
      recipeComponentKind: component.componentKind,
      subRecipeId: component.subRecipeId,
      // §6: quantity is rounded at B0, the line-cost amount at B2 and the
      // sub-recipe unit cost at B3.
      roundingBoundaries: { quantity: "B0", amount: "B2", unitCost: "B3" },
    },
  }));

  for (const [field, componentKind] of SUPPLIED_COMPONENT_KINDS) {
    const amount = supplied[field];
    if (parseDecimal(amount, MONEY_SCALE) === 0n) {
      continue;
    }
    components.push({
      componentKind,
      amount,
      roundingBoundary: "B2",
      provenance: {
        sourceType: componentSourceType(field, resolved),
        roundingBoundaries: { amount: "B2" },
      },
    });
  }

  return components;
}

/**
 * Assembles the cost-card composition and its snapshot components (DEC-111). The
 * recipe version is the effective `product_recipe_assignment` for
 * `(productVariantId, locationId)` at `asOf`; a supplied explicit
 * `recipeVersionId` is used when no assignment is effective and must agree with
 * the assignment when one is, so only "neither present" is rejected (never
 * defaulted). The
 * ingredient/packaging split comes from `computeRecipeCost` ÷ the version's
 * `approvedUsableOutput`; `unitNetSales` is the effective
 * `price_version.netPrice`. A missing effective price version is rejected — a
 * card without a price cannot show a contribution.
 */
export async function assembleCostCardComposition(
  store: CostCardComponentStore,
  input: AssembleCostCardCompositionInput,
): Promise<AssembleCostCardCompositionResult> {
  assertNonEmpty(input.organizationId, "organizationId");
  assertNonEmpty(input.productVariantId, "productVariantId");
  assertNonEmpty(input.locationId, "locationId");
  assertValidDate(input.asOf, "asOf");
  const currency = normalizeCurrency(input.currency ?? "NOK");

  const explicit = {
    directLaborCost: readSuppliedMoney(input.directLaborCost, "directLaborCost"),
    channelVariableCost: readSuppliedMoney(input.channelVariableCost, "channelVariableCost"),
    otherVariableCost: readSuppliedMoney(input.otherVariableCost, "otherVariableCost"),
    allocatedUnitOverhead: readSuppliedMoney(input.allocatedUnitOverhead, "allocatedUnitOverhead"),
  };

  const assignment = await store.findVariantRecipeAssignment({
    organizationId: input.organizationId,
    productVariantId: input.productVariantId,
    locationId: input.locationId,
    asOf: input.asOf,
  });
  // DEC-111: the effective assignment wins. An explicit `recipeVersionId` may
  // stand in when no assignment is effective, and when both exist they must
  // agree; only "no assignment and no explicit id" is rejected.
  const explicitRecipeVersionId = input.recipeVersionId ?? null;
  if (
    assignment !== undefined &&
    explicitRecipeVersionId !== null &&
    explicitRecipeVersionId !== assignment.recipeVersionId
  ) {
    throw new DomainError(
      "the supplied recipeVersionId does not match the effective recipe assignment (DEC-111)",
    );
  }
  const recipeVersionId = assignment?.recipeVersionId ?? explicitRecipeVersionId;
  if (recipeVersionId === null) {
    throw new DomainError(
      "no product recipe assignment is effective for this variant, location and date and no explicit recipeVersionId was supplied (DEC-111)",
    );
  }

  const version = await store.findRecipeVersion(recipeVersionId);
  if (version === undefined) {
    throw new DomainError("recipe version not found");
  }
  const output = parseDecimal(version.approvedUsableOutput, QUANTITY_SCALE);
  if (output <= 0n) {
    throw new DomainError("approvedUsableOutput must be positive (CALCULATION_CONTRACT §12.2)");
  }

  const cost = await computeRecipeCost(store, {
    organizationId: input.organizationId,
    recipeVersionId,
    asOf: input.asOf,
    currency,
  });

  const ingredientCost = bucketCostPerUnit(
    currency,
    cost.components,
    ["ingredient", "sub_recipe"],
    version.approvedUsableOutput,
  );
  const packagingCost = bucketCostPerUnit(
    currency,
    cost.components,
    ["packaging"],
    version.approvedUsableOutput,
  );

  // Exact-scope resolution only. Whether a scope fallback (a null
  // location/channel wildcard) is wanted is a recorded `DEC-077` open point; a
  // fallback hierarchy is deliberately not invented here.
  const priceVersion = await store.findEffectivePriceVersion({
    organizationId: input.organizationId,
    productVariantId: input.productVariantId,
    locationId: input.locationId,
    channelId: input.channelId ?? null,
    asOf: input.asOf,
  });
  if (priceVersion === undefined) {
    throw new DomainError(
      "no effective price version for this variant, location, channel and date (DEC-111)",
    );
  }
  const unitNetSales = priceVersion.netPrice;
  const unitNetSalesParsed = parseDecimal(unitNetSales, MONEY_SCALE);
  if (unitNetSalesParsed < 0n) {
    throw new DomainError("unitNetSales must not be negative");
  }

  // DEC-112: a resolved component wins over the explicit input; a resolver that
  // has nothing to resolve (`undefined`) leaves the explicit input in place.
  const labor = await resolveDirectLaborCost(store, {
    organizationId: input.organizationId,
    asOf: input.asOf,
    preparationMinutes: version.preparationMinutes,
    laborCostCenterId: version.laborCostCenterId,
    laborRoleCode: version.laborRoleCode,
    approvedUsableOutput: version.approvedUsableOutput,
  });

  const channelId = input.channelId ?? null;
  const channel =
    channelId === null
      ? undefined
      : await resolveChannelVariableCost(store, {
          organizationId: input.organizationId,
          channelId,
          asOf: input.asOf,
          grossPrice: priceVersion.grossPrice,
          netPrice: priceVersion.netPrice,
          ...(input.unitsPerOrder === undefined ? {} : { unitsPerOrder: input.unitsPerOrder }),
        });

  const costPoolId = input.costPoolId ?? null;
  const periodFrom = parseOptionalInstant(input.periodFrom, "periodFrom");
  const periodTo = parseOptionalInstant(input.periodTo, "periodTo");
  const overhead =
    costPoolId === null
      ? undefined
      : await resolveAllocatedUnitOverhead(store, {
          organizationId: input.organizationId,
          costPoolId,
          locationId: input.locationId,
          asOf: input.asOf,
          ...(periodFrom === undefined ? {} : { periodFrom }),
          ...(periodTo === undefined ? {} : { periodTo }),
        });

  const supplied: CostCardCompositionProvenance["supplied"] = {
    directLaborCost: labor?.perUnitCost ?? explicit.directLaborCost,
    channelVariableCost: channel?.perUnitCost ?? explicit.channelVariableCost,
    otherVariableCost: explicit.otherVariableCost,
    allocatedUnitOverhead: overhead?.perUnitOverhead ?? explicit.allocatedUnitOverhead,
  };
  const resolved: CostCardResolvedComponents = {
    directLaborCost: labor !== undefined,
    channelVariableCost: channel !== undefined,
    allocatedUnitOverhead: overhead !== undefined,
  };

  const composition: CostCardCompositionInput = {
    currency,
    ingredientCost,
    packagingCost,
    unitNetSales,
    ...supplied,
  };

  return {
    composition,
    components: buildComponents(cost.components, supplied, resolved),
    recipeVersionId,
    snapshotOptions: {
      ...(input.taxRuleSnapshot === undefined ? {} : { taxRuleSnapshot: input.taxRuleSnapshot }),
      ...(input.fxRateId === undefined ? {} : { fxRateId: input.fxRateId }),
      ...(input.roundingScales === undefined ? {} : { roundingScales: input.roundingScales }),
    },
    provenance: {
      recipeVersionId,
      approvedUsableOutput: version.approvedUsableOutput,
      priceVersionId: priceVersion.id,
      assembled: { ingredientCost, packagingCost, unitNetSales },
      supplied,
      resolved,
      notes: [
        "ingredientCost, packagingCost and unitNetSales were assembled from the effective recipe assignment and price version",
        "directLaborCost, channelVariableCost and allocatedUnitOverhead are resolved from the effective recipe labour mapping, channel fee rules and operating-cost pool where available, otherwise from the explicit command input (DEC-112)",
        "otherVariableCost is an explicit command input and is not resolved (DEC-112)",
      ],
    },
  };
}
