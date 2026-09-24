import {
  applyProductiveHoursPct,
  DomainError,
  divideRoundHalfUp,
  formatDecimal,
  LOADED_RATE_SCALE,
  MONEY_SCALE,
  normalizeCurrency,
  parseDecimal,
  QUANTITY_SCALE,
  selectEffectiveRecipeVersion,
} from "@aquarela/domain";

import { assembleCostCardComposition } from "../costing/assemble-cost-card-composition";
import { SALES_REPORT_UNMAPPED_KEY } from "../reporting/types";

import type {
  SimulationCapacity,
  SimulationDelta,
  SimulationLine,
  SimulationResult,
  SimulationScenario,
  SimulationStore,
} from "./types";

/**
 * The what-if simulation (`W6`, `DEC-125`). A pure read-only model over the
 * canonical facts: it reads the baseline sales lines grouped by product and
 * re-costs each one through the existing cost chain
 * (`assembleCostCardComposition` — which itself calls `computeRecipeCost`, the
 * `DEC-112` labour/channel/overhead resolvers and the effective
 * `price_version.netPrice`), then applies the scenario's deltas arithmetically.
 *
 * The model is deliberately linear and explicit:
 *
 * ```
 * baseline_units      = actual posted units per product in [from, to]          # summarizeSales
 * baseline_unit_price = effective price_version.netPrice                      # via the assembler
 * unit_cost           = ingredient + packaging + direct_labour + channel
 *                       + other_variable + allocated_overhead                  # via the assembler
 * scenario_units      = baseline_units × (1 + volumePct/100)   (removed → 0)
 * scenario_unit_price = baseline_unit_price × (1 + pricePct/100)
 * scenario_unit_cost  = unit_cost with direct_labour × (1 + wagePct/100)
 * revenue             = Σ scenario_units × scenario_unit_price
 * cost                = Σ scenario_units × scenario_unit_cost  + added_headcount_cost
 * contribution        = revenue − cost
 * ```
 *
 * Every figure it cannot compute is reported in `unmodelled` with the reason —
 * never substituted with a guess. All arithmetic is decimal-only (`BigInt`),
 * rounded HALF_UP at `MONEY_SCALE` (4 dp) or `QUANTITY_SCALE` (6 dp).
 */

const HOURS_SCALE = QUANTITY_SCALE;
const PCT_SCALE = 6;
const PERCENT_ONE = 100n * 10n ** BigInt(PCT_SCALE);
const HOURS_TO_MINUTES = 60n;

/** `value × (1 + pct/100)`, rounded HALF_UP at `valueScale`. */
function applyPercent(value: string, valueScale: number, pct: string): string {
  const valueScaled = parseDecimal(value, valueScale);
  const pctScaled = parseDecimal(pct, PCT_SCALE);
  const numerator = valueScaled * (PERCENT_ONE + pctScaled);
  return formatDecimal(divideRoundHalfUp(numerator, PERCENT_ONE), valueScale);
}

/** `a × b`, rounded HALF_UP at `outScale`, where `a`/`b` carry their own scales. */
function multiplyScaled(
  a: string,
  aScale: number,
  b: string,
  bScale: number,
  outScale: number,
): string {
  const divisor = 10n ** BigInt(aScale + bScale - outScale);
  return formatDecimal(
    divideRoundHalfUp(parseDecimal(a, aScale) * parseDecimal(b, bScale), divisor),
    outScale,
  );
}

/** Sums money strings at `MONEY_SCALE` (no rounding — a sum is exact). */
function sumMoney(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) {
    total += parseDecimal(value, MONEY_SCALE);
  }
  return formatDecimal(total, MONEY_SCALE);
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new DomainError(`${field} must not be empty`);
  }
}

function parseInstant(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError(`${field} must be an ISO-8601 instant`);
  }
  return parsed;
}

/** A one-line reason for a per-line failure, without leaking internals. */
function reason(error: unknown): string {
  return error instanceof DomainError ? error.message : "the cost chain rejected the read";
}

/** The unit cost and its components as resolved for one product variant. */
interface ResolvedUnit {
  readonly productVariantId: string;
  readonly recipeId: string;
  readonly recipeVersionId: string;
  readonly approvedUsableOutput: string;
  readonly preparationMinutes: number | null;
  readonly laborCostCenterId: string | null;
  readonly laborRoleCode: string | null;
  /** True when the `DEC-112` labour resolver produced the direct-labour cost. */
  readonly directLaborResolved: boolean;
  readonly unitNetPrice: string;
  readonly ingredientCost: string;
  readonly packagingCost: string;
  readonly directLaborCost: string;
  readonly channelVariableCost: string;
  readonly otherVariableCost: string;
  readonly allocatedUnitOverhead: string;
}

/**
 * Re-costs one product variant through the existing cost chain. `explicitRecipeVersionId`
 * pins the version for a menu addition (whose variant is resolved from the
 * recipe); for a baseline product the effective assignment stands.
 */
async function resolveUnit(
  store: SimulationStore,
  query: {
    readonly organizationId: string;
    readonly locationId: string;
    readonly asOf: Date;
    readonly currency: string;
    readonly productVariantId: string;
    readonly explicitRecipeVersionId?: string;
  },
): Promise<ResolvedUnit> {
  const assembly = await assembleCostCardComposition(store, {
    organizationId: query.organizationId,
    productVariantId: query.productVariantId,
    locationId: query.locationId,
    asOf: query.asOf,
    currency: query.currency,
    ...(query.explicitRecipeVersionId === undefined
      ? {}
      : { recipeVersionId: query.explicitRecipeVersionId }),
  });
  const version = await store.findRecipeVersion(assembly.recipeVersionId);
  if (version === undefined) {
    throw new DomainError("recipe version not found after assembly");
  }
  return {
    productVariantId: query.productVariantId,
    recipeId: version.recipeId,
    recipeVersionId: assembly.recipeVersionId,
    approvedUsableOutput: assembly.provenance.approvedUsableOutput,
    preparationMinutes: version.preparationMinutes,
    laborCostCenterId: version.laborCostCenterId,
    laborRoleCode: version.laborRoleCode,
    directLaborResolved: assembly.provenance.resolved.directLaborCost,
    unitNetPrice: assembly.provenance.assembled.unitNetSales,
    ingredientCost: assembly.provenance.assembled.ingredientCost,
    packagingCost: assembly.provenance.assembled.packagingCost,
    directLaborCost: assembly.provenance.supplied.directLaborCost,
    channelVariableCost: assembly.provenance.supplied.channelVariableCost,
    otherVariableCost: assembly.provenance.supplied.otherVariableCost,
    allocatedUnitOverhead: assembly.provenance.supplied.allocatedUnitOverhead,
  };
}

/** The full unit cost, optionally scaling the direct-labour component by a wage delta. */
function unitCost(unit: ResolvedUnit, wageChangePct: string | undefined): string {
  const labour =
    wageChangePct === undefined
      ? unit.directLaborCost
      : applyPercent(unit.directLaborCost, MONEY_SCALE, wageChangePct);
  return sumMoney([
    unit.ingredientCost,
    unit.packagingCost,
    labour,
    unit.channelVariableCost,
    unit.otherVariableCost,
    unit.allocatedUnitOverhead,
  ]);
}

/** `units × unitPrice` at `MONEY_SCALE`. */
function revenueOf(units: string, unitPrice: string): string {
  return multiplyScaled(units, QUANTITY_SCALE, unitPrice, MONEY_SCALE, MONEY_SCALE);
}

/**
 * The direct-labour hours one volume of units requires:
 * `units × preparation_minutes / 60 / approved_usable_output`, at 6 dp. `null`
 * when the version carries no preparation minutes (the hours are then unknown).
 */
function hoursForUnits(unit: ResolvedUnit, units: string): string | null {
  if (unit.preparationMinutes === null) {
    return null;
  }
  const output = parseDecimal(unit.approvedUsableOutput, QUANTITY_SCALE);
  if (output <= 0n) {
    return null;
  }
  const minutes = parseDecimal(String(unit.preparationMinutes), QUANTITY_SCALE);
  const unitsScaled = parseDecimal(units, QUANTITY_SCALE);
  // hours = units × minutes / (60 × output); keep 6 dp.
  const numerator = unitsScaled * minutes;
  const denominator = HOURS_TO_MINUTES * output;
  return formatDecimal(divideRoundHalfUp(numerator, denominator), HOURS_SCALE);
}

function deltaOf(baseline: bigint, scenario: bigint): SimulationDelta {
  const absolute = scenario - baseline;
  const relativePct =
    baseline === 0n ? null : formatDecimal(divideRoundHalfUp(absolute * 100n * 100n, baseline), 2);
  return { absolute: formatDecimal(absolute, MONEY_SCALE), relativePct };
}

export async function simulateScenario(
  store: SimulationStore,
  scenario: SimulationScenario,
): Promise<SimulationResult> {
  assertNonEmpty(scenario.organizationId, "organizationId");
  assertNonEmpty(scenario.locationId, "locationId");
  const asOf = parseInstant(scenario.asOf, "asOf");
  const from = parseInstant(scenario.baseline.periodFrom, "baseline.periodFrom");
  const to = parseInstant(scenario.baseline.periodTo, "baseline.periodTo");
  if (to.getTime() < from.getTime()) {
    throw new DomainError("baseline.periodTo must be on or after baseline.periodFrom");
  }
  const currency = normalizeCurrency(scenario.currency ?? "NOK");

  // Validate every percentage up front so a malformed scenario fails before any read.
  for (const value of [scenario.volumeChangePct, scenario.priceChangePct, scenario.wageChangePct]) {
    if (value !== undefined) {
      parseDecimal(value, PCT_SCALE);
    }
  }

  const assumptions: string[] = [];
  const provenance: string[] = [];
  const unmodelled: string[] = [];

  const summary = await store.summarizeSales({
    organizationId: scenario.organizationId,
    from: scenario.baseline.periodFrom,
    to: scenario.baseline.periodTo,
    grain: "month",
    groupBy: "product",
    locationIds: [scenario.locationId],
  });
  provenance.push(
    `baseline units and posted net sales: summarizeSales(groupBy=product, ${scenario.baseline.periodFrom}..${scenario.baseline.periodTo}, location ${scenario.locationId}) — RPT-001 read`,
  );
  provenance.push(
    `unit costs and effective net prices: assembleCostCardComposition per product at ${scenario.asOf} (computeRecipeCost + the DEC-112 labour/channel/overhead resolvers + price_version.netPrice)`,
  );

  const removalIds = new Set((scenario.menuRemovals ?? []).map((removal) => removal.recipeId));
  const removedSeen = new Set<string>();

  const lines: SimulationLine[] = [];
  let baselineRevenue = 0n;
  let baselineCost = 0n;
  let scenarioRevenue = 0n;
  let scenarioCost = 0n;
  let baselineRequiredHours = 0n;
  let scenarioRequiredHours = 0n;
  let postedNetSales = 0n;
  let hoursUnknown = false;
  const labourUnresolved: string[] = [];

  /** A version that maps direct labour but resolved no rate is a modelled zero. */
  const noteUnresolvedLabour = (label: string, unit: ResolvedUnit): void => {
    if (
      unit.preparationMinutes !== null &&
      unit.laborCostCenterId !== null &&
      unit.laborRoleCode !== null &&
      !unit.directLaborResolved
    ) {
      labourUnresolved.push(label);
    }
  };

  for (const row of summary.rows) {
    postedNetSales += parseDecimal(row.netSales, MONEY_SCALE);
    if (row.productVariantId === null || row.key === SALES_REPORT_UNMAPPED_KEY) {
      unmodelled.push(
        `the "${row.label}" sales group (${row.units} units, ${row.netSales} posted net sales) has no resolved product variant, so it is excluded from the model`,
      );
      continue;
    }

    let unit: ResolvedUnit;
    try {
      unit = await resolveUnit(store, {
        organizationId: scenario.organizationId,
        locationId: scenario.locationId,
        asOf,
        currency,
        productVariantId: row.productVariantId,
      });
    } catch (error) {
      unmodelled.push(
        `product "${row.label}" (${row.units} units, ${row.netSales} posted net sales) could not be costed: ${reason(error)}`,
      );
      continue;
    }

    const removed = removalIds.has(unit.recipeId);
    if (removed) {
      removedSeen.add(unit.recipeId);
    }
    noteUnresolvedLabour(row.label, unit);
    const baselineUnits = row.units;
    const scenarioUnits = removed
      ? "0"
      : scenario.volumeChangePct === undefined
        ? baselineUnits
        : applyPercent(baselineUnits, QUANTITY_SCALE, scenario.volumeChangePct);
    const baselineUnitPrice = unit.unitNetPrice;
    const scenarioUnitPrice =
      scenario.priceChangePct === undefined
        ? baselineUnitPrice
        : applyPercent(baselineUnitPrice, MONEY_SCALE, scenario.priceChangePct);
    const baselineUnitCost = unitCost(unit, undefined);
    const scenarioUnitCost = unitCost(unit, scenario.wageChangePct);

    const lineBaselineRevenue = revenueOf(baselineUnits, baselineUnitPrice);
    const lineScenarioRevenue = revenueOf(scenarioUnits, scenarioUnitPrice);
    const lineBaselineCost = revenueOf(baselineUnits, baselineUnitCost);
    const lineScenarioCost = revenueOf(scenarioUnits, scenarioUnitCost);

    baselineRevenue += parseDecimal(lineBaselineRevenue, MONEY_SCALE);
    baselineCost += parseDecimal(lineBaselineCost, MONEY_SCALE);
    scenarioRevenue += parseDecimal(lineScenarioRevenue, MONEY_SCALE);
    scenarioCost += parseDecimal(lineScenarioCost, MONEY_SCALE);

    const baselineHours = hoursForUnits(unit, baselineUnits);
    const scenarioHours = hoursForUnits(unit, scenarioUnits);
    if (baselineHours === null || scenarioHours === null) {
      hoursUnknown = true;
    } else {
      baselineRequiredHours += parseDecimal(baselineHours, HOURS_SCALE);
      scenarioRequiredHours += parseDecimal(scenarioHours, HOURS_SCALE);
    }

    lines.push({
      kind: "baseline",
      label: row.label,
      productVariantId: unit.productVariantId,
      recipeId: unit.recipeId,
      recipeVersionId: unit.recipeVersionId,
      baselineUnits,
      scenarioUnits,
      baselineUnitPrice,
      scenarioUnitPrice,
      unitCost: baselineUnitCost,
      baselineRevenue: lineBaselineRevenue,
      scenarioRevenue: lineScenarioRevenue,
      baselineCost: lineBaselineCost,
      scenarioCost: lineScenarioCost,
      baselineContribution: formatDecimal(
        parseDecimal(lineBaselineRevenue, MONEY_SCALE) -
          parseDecimal(lineBaselineCost, MONEY_SCALE),
        MONEY_SCALE,
      ),
      scenarioContribution: formatDecimal(
        parseDecimal(lineScenarioRevenue, MONEY_SCALE) -
          parseDecimal(lineScenarioCost, MONEY_SCALE),
        MONEY_SCALE,
      ),
    });
  }

  for (const removal of scenario.menuRemovals ?? []) {
    if (!removedSeen.has(removal.recipeId)) {
      unmodelled.push(
        `menu removal of recipe "${removal.recipeId}" had no matching product line in the baseline, so it changed nothing`,
      );
    }
  }

  // Menu additions: resolve the recipe's effective approved version, the variant
  // assigned to it and the effective price, then re-cost through the same chain.
  for (const addition of scenario.menuAdds ?? []) {
    const expectedUnits = parseDecimal(addition.expectedUnitsPerPeriod, QUANTITY_SCALE);
    if (expectedUnits < 0n) {
      throw new DomainError("menuAdds.expectedUnitsPerPeriod must not be negative");
    }
    try {
      const recipe = await store.findRecipe(addition.recipeId);
      if (recipe === undefined || recipe.organizationId !== scenario.organizationId) {
        throw new DomainError("recipe not found in organization");
      }
      const versions = (await store.listRecipeVersions(addition.recipeId)).filter(
        (version) => version.state === "approved",
      );
      const effective = selectEffectiveRecipeVersion(versions, asOf);
      if (effective === undefined) {
        throw new DomainError("recipe has no approved version effective at asOf");
      }
      const variant = await store.findVariantForRecipeVersion({
        organizationId: scenario.organizationId,
        recipeVersionId: effective.id,
        locationId: scenario.locationId,
        asOf,
      });
      if (variant === undefined) {
        throw new DomainError("no product variant is assigned to this recipe at the location");
      }
      const unit = await resolveUnit(store, {
        organizationId: scenario.organizationId,
        locationId: scenario.locationId,
        asOf,
        currency,
        productVariantId: variant.productVariantId,
        explicitRecipeVersionId: effective.id,
      });
      noteUnresolvedLabour(recipe.name, unit);

      const scenarioUnits = addition.expectedUnitsPerPeriod;
      const scenarioUnitPrice =
        scenario.priceChangePct === undefined
          ? unit.unitNetPrice
          : applyPercent(unit.unitNetPrice, MONEY_SCALE, scenario.priceChangePct);
      const scenarioUnitCost = unitCost(unit, scenario.wageChangePct);
      const lineScenarioRevenue = revenueOf(scenarioUnits, scenarioUnitPrice);
      const lineScenarioCost = revenueOf(scenarioUnits, scenarioUnitCost);
      scenarioRevenue += parseDecimal(lineScenarioRevenue, MONEY_SCALE);
      scenarioCost += parseDecimal(lineScenarioCost, MONEY_SCALE);

      const scenarioHours = hoursForUnits(unit, scenarioUnits);
      if (scenarioHours === null) {
        hoursUnknown = true;
      } else {
        scenarioRequiredHours += parseDecimal(scenarioHours, HOURS_SCALE);
      }

      lines.push({
        kind: "added",
        label: recipe.name,
        productVariantId: unit.productVariantId,
        recipeId: unit.recipeId,
        recipeVersionId: unit.recipeVersionId,
        baselineUnits: "0",
        scenarioUnits,
        baselineUnitPrice: null,
        scenarioUnitPrice,
        unitCost: unitCost(unit, undefined),
        baselineRevenue: "0.0000",
        scenarioRevenue: lineScenarioRevenue,
        baselineCost: "0.0000",
        scenarioCost: lineScenarioCost,
        baselineContribution: "0.0000",
        scenarioContribution: formatDecimal(
          parseDecimal(lineScenarioRevenue, MONEY_SCALE) -
            parseDecimal(lineScenarioCost, MONEY_SCALE),
          MONEY_SCALE,
        ),
      });
    } catch (error) {
      unmodelled.push(
        `menu addition of recipe "${addition.recipeId}" (${addition.expectedUnitsPerPeriod} units) could not be modelled: ${reason(error)}`,
      );
    }
  }

  // Headcount: added labour cost at the effective loaded rate, and the hours it buys.
  let addedHours = 0n;
  let addedLabourCost = 0n;
  for (const change of scenario.headcountChange ?? []) {
    const count = parseDecimal(change.countDelta, QUANTITY_SCALE);
    const hours = parseDecimal(change.hoursPerPeriod, QUANTITY_SCALE);
    const rowHours = divideRoundHalfUp(count * hours, 10n ** BigInt(QUANTITY_SCALE));
    addedHours += rowHours;

    const costCenterId = change.costCenterId ?? null;
    if (costCenterId === null) {
      unmodelled.push(
        `headcount change for role "${change.roleCode}" has no costCenterId, so no effective labour rate could be read; its hours are counted but its cost is not modelled`,
      );
      continue;
    }
    const rate = await store.findEffectiveLaborRate({
      organizationId: scenario.organizationId,
      costCenterId,
      roleCode: change.roleCode,
      asOf,
    });
    if (rate === undefined) {
      unmodelled.push(
        `headcount change for role "${change.roleCode}" has no effective labour rate at ${scenario.asOf}; its hours are counted but its cost is not modelled`,
      );
      continue;
    }
    provenance.push(
      `headcount role "${change.roleCode}" rate: findEffectiveLaborRate(${costCenterId}, ${change.roleCode}) at ${scenario.asOf}`,
    );
    const effectiveRate =
      rate.productiveHoursPct === null
        ? rate.loadedHourlyRate
        : applyProductiveHoursPct(rate.loadedHourlyRate, rate.productiveHoursPct);
    const cost = multiplyScaled(
      formatDecimal(rowHours, HOURS_SCALE),
      HOURS_SCALE,
      effectiveRate,
      LOADED_RATE_SCALE,
      MONEY_SCALE,
    );
    addedLabourCost += parseDecimal(cost, MONEY_SCALE);
  }
  scenarioCost += addedLabourCost;

  const baselineContribution = baselineRevenue - baselineCost;
  const scenarioContribution = scenarioRevenue - scenarioCost;

  const scenarioSuppliedHours = baselineRequiredHours + addedHours;
  const gapHours = scenarioRequiredHours - scenarioSuppliedHours;
  const capacity: SimulationCapacity = {
    baselineRequiredHours: formatDecimal(baselineRequiredHours, HOURS_SCALE),
    scenarioRequiredHours: formatDecimal(scenarioRequiredHours, HOURS_SCALE),
    addedSuppliedHours: formatDecimal(addedHours, HOURS_SCALE),
    scenarioSuppliedHours: formatDecimal(scenarioSuppliedHours, HOURS_SCALE),
    gapHours: formatDecimal(gapHours, HOURS_SCALE),
    note: "capacity is direct-labour hours only; the current workforce is assumed to supply exactly the baseline requirement, so a positive gap is a modelled shortfall, not a fact",
  };

  // Assumptions — every input, every held-constant, every limitation.
  assumptions.push(
    `baseline period ${scenario.baseline.periodFrom}..${scenario.baseline.periodTo} at location ${scenario.locationId}, resolved at ${scenario.asOf}`,
  );
  assumptions.push(
    "baseline volume is the actual posted units per product in the period (no volume change is applied to the baseline side)",
  );
  assumptions.push(
    `baseline unit price is the effective approved net price (price_version.netPrice); it excludes discounts, refunds and tax, so modelled baseline revenue (${formatDecimal(baselineRevenue, MONEY_SCALE)}) may differ from posted net sales (${formatDecimal(postedNetSales, MONEY_SCALE)})`,
  );
  assumptions.push(
    "unit cost is a current-cost model resolved at asOf, not the historical posted cost; it includes only the components the cost chain could resolve",
  );
  if (scenario.volumeChangePct !== undefined) {
    assumptions.push(
      `every baseline volume is scaled by ${scenario.volumeChangePct}%; a removed item's volume is set to zero`,
    );
  }
  if (scenario.priceChangePct !== undefined) {
    assumptions.push(
      `every net price (baseline and added) is scaled by ${scenario.priceChangePct}%`,
    );
  }
  if (scenario.wageChangePct !== undefined) {
    assumptions.push(
      `the direct-labour component of every unit cost is scaled by ${scenario.wageChangePct}%; ingredients, packaging, channel fees and overhead are held constant`,
    );
  }
  if ((scenario.headcountChange ?? []).length > 0) {
    assumptions.push(
      "added labour cost is countDelta × hoursPerPeriod × the effective loaded hourly rate for the (costCentre, role) pair; the rate is the effective rate at asOf",
    );
  }
  assumptions.push(
    "channel fees and allocated overhead are held at zero because the scenario supplies no channel or cost pool, so the modelled full cost excludes them",
  );
  assumptions.push(
    "the model is a linear extrapolation: unit costs and prices are assumed not to change with volume (no supplier volume breaks, no labour efficiency curve, no fixed-cost step)",
  );
  assumptions.push(
    "the model is a what-if, not a forecast; it changes no posted fact and no price version",
  );

  provenance.push(
    `effective labour rate (headcount rows): findEffectiveLaborRate at ${scenario.asOf}`,
  );
  provenance.push(
    "menu additions/removals: listRecipeVersions + selectEffectiveRecipeVersion + the effective product_recipe_assignment, re-costed through the same chain",
  );

  // Unmodelled — what the model cannot say, and why.
  if (labourUnresolved.length > 0) {
    unmodelled.push(
      `direct labour is modelled as zero for ${labourUnresolved.join(", ")}: the recipe maps a labour cost centre and role but no effective labour rate exists at ${scenario.asOf}`,
    );
  }
  unmodelled.push(
    "channel fees and allocated overhead are not modelled (no channel or cost pool is part of the scenario)",
  );
  if (hoursUnknown) {
    unmodelled.push(
      "at least one product version carries no preparation_minutes, so its direct-labour hours are excluded from the capacity figure",
    );
  }
  unmodelled.push(
    "the model cannot say whether a volume change is achievable (demand, supplier capacity, equipment, storage)",
  );
  unmodelled.push(
    "seasonality, competitor reactions, marketing effects, cash flow, tax and working capital are not modelled",
  );

  return {
    asOf: scenario.asOf,
    locationId: scenario.locationId,
    currency,
    period: { from: scenario.baseline.periodFrom, to: scenario.baseline.periodTo },
    baselineCost: formatDecimal(baselineCost, MONEY_SCALE),
    scenarioCost: formatDecimal(scenarioCost, MONEY_SCALE),
    baselineRevenue: formatDecimal(baselineRevenue, MONEY_SCALE),
    scenarioRevenue: formatDecimal(scenarioRevenue, MONEY_SCALE),
    baselineContribution: formatDecimal(baselineContribution, MONEY_SCALE),
    scenarioContribution: formatDecimal(scenarioContribution, MONEY_SCALE),
    deltas: {
      cost: deltaOf(baselineCost, scenarioCost),
      revenue: deltaOf(baselineRevenue, scenarioRevenue),
      contribution: deltaOf(baselineContribution, scenarioContribution),
    },
    baselinePostedNetSales: formatDecimal(postedNetSales, MONEY_SCALE),
    lines,
    capacity,
    assumptions,
    provenance,
    unmodelled,
  };
}
