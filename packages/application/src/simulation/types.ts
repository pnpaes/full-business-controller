import type { CostCardComponentStore } from "../costing/assemble-cost-card-composition";
import type { SalesSummary, SalesSummaryQuery } from "../reporting/types";

/**
 * Application-level ports and DTOs for the **what-if simulation** (`W6`,
 * `DEC-125`). The simulation is a pure model: it reads the canonical facts, reuses
 * the existing cost chain (`assembleCostCardComposition` and its resolvers, the
 * effective labour rate and the effective price version) and reports the modelled
 * effect of a scenario. It writes nothing — no audit fact, no table, no schema
 * change — and it never presents a modelled figure as a fact: every result
 * carries its assumptions, its provenance and the terms it could not model.
 *
 * All money/quantity values are decimal strings (never floats), rounded HALF_UP
 * at the calculation contract's boundaries.
 */

/** The store the simulation reads through. Read-only. */
export interface SimulationStore extends CostCardComponentStore {
  /** The baseline sales lines grouped by product (`RPT-001` read, reused). */
  summarizeSales(query: SalesSummaryQuery): Promise<SalesSummary>;
  /**
   * The product variant assigned to a recipe version at a location/instant
   * (`product_recipe_assignment`), or `undefined`. Read through the relational
   * client, mirroring the recipe store's `findVariantRecipeAssignment`.
   */
  findVariantForRecipeVersion(query: {
    readonly organizationId: string;
    readonly recipeVersionId: string;
    readonly locationId: string;
    readonly asOf: Date;
  }): Promise<{ readonly productVariantId: string } | undefined>;
}

/** One menu addition the scenario proposes. */
export interface SimulationMenuAdd {
  readonly recipeId: string;
  /** Expected units sold per baseline period (a decimal string). */
  readonly expectedUnitsPerPeriod: string;
}

/** One menu removal the scenario proposes. */
export interface SimulationMenuRemoval {
  readonly recipeId: string;
}

/** One headcount change the scenario proposes. */
export interface SimulationHeadcountChange {
  readonly roleCode: string;
  /** Signed headcount change (e.g. `"2"` or `"-1"`). */
  readonly countDelta: string;
  /** Paid hours per employee per baseline period (a decimal string). */
  readonly hoursPerPeriod: string;
  /**
   * The cost centre the effective labour rate is read for. Without it the added
   * labour cost cannot be read, so the row is reported in `unmodelled`.
   */
  readonly costCenterId?: string | null;
}

/** The scenario: a baseline period plus the deltas to model. */
export interface SimulationScenario {
  readonly organizationId: string;
  /** The instant the effective recipe/price/labour reads resolve at (ISO). */
  readonly asOf: string;
  /** The location scope the cost chain and the sales read resolve within. */
  readonly locationId: string;
  readonly baseline: {
    /** Inclusive lower bound on the baseline sales window (ISO). */
    readonly periodFrom: string;
    /** Inclusive upper bound on the baseline sales window (ISO). */
    readonly periodTo: string;
  };
  /** Percentage change to every baseline volume, e.g. `"10"` or `"-20"`. */
  readonly volumeChangePct?: string;
  /** Percentage change to every net price. */
  readonly priceChangePct?: string;
  /** Percentage change to the direct-labour component of every unit cost. */
  readonly wageChangePct?: string;
  readonly menuAdds?: readonly SimulationMenuAdd[];
  readonly menuRemovals?: readonly SimulationMenuRemoval[];
  readonly headcountChange?: readonly SimulationHeadcountChange[];
  /** Defaults to `NOK` (the only Phase 1 reporting currency). */
  readonly currency?: string;
}

/** An absolute + relative delta for one measure. */
export interface SimulationDelta {
  readonly absolute: string;
  /** `null` when the baseline is zero (the ratio is undefined). */
  readonly relativePct: string | null;
}

/** One modelled product line, baseline vs scenario. */
export interface SimulationLine {
  readonly kind: "baseline" | "added";
  readonly label: string;
  readonly productVariantId: string | null;
  readonly recipeId: string | null;
  readonly recipeVersionId: string | null;
  readonly baselineUnits: string;
  readonly scenarioUnits: string;
  /** The effective net price; `null` when the price version was missing. */
  readonly baselineUnitPrice: string | null;
  readonly scenarioUnitPrice: string | null;
  /** The modelled full unit cost at baseline wages. */
  readonly unitCost: string;
  readonly baselineRevenue: string;
  readonly scenarioRevenue: string;
  readonly baselineCost: string;
  readonly scenarioCost: string;
  readonly baselineContribution: string;
  readonly scenarioContribution: string;
}

/** The modelled labour-hours position. */
export interface SimulationCapacity {
  /** Modelled direct-labour hours the baseline volume requires. */
  readonly baselineRequiredHours: string;
  /** Modelled direct-labour hours the scenario volume requires. */
  readonly scenarioRequiredHours: string;
  /** Hours the added headcount supplies over the period. */
  readonly addedSuppliedHours: string;
  /** Baseline requirement + added hours (the current workforce is assumed to supply the baseline). */
  readonly scenarioSuppliedHours: string;
  /** `scenarioRequiredHours − scenarioSuppliedHours`; negative = surplus. */
  readonly gapHours: string;
  readonly note: string;
}

/** The simulation result: the two sides, the deltas, and the honesty block. */
export interface SimulationResult {
  readonly asOf: string;
  readonly locationId: string;
  readonly currency: string;
  readonly period: { readonly from: string; readonly to: string };
  readonly baselineCost: string;
  readonly scenarioCost: string;
  readonly baselineRevenue: string;
  readonly scenarioRevenue: string;
  readonly baselineContribution: string;
  readonly scenarioContribution: string;
  readonly deltas: {
    readonly cost: SimulationDelta;
    readonly revenue: SimulationDelta;
    readonly contribution: SimulationDelta;
  };
  /** Actual posted net sales in the baseline window, for reconciliation only. */
  readonly baselinePostedNetSales: string;
  readonly lines: readonly SimulationLine[];
  readonly capacity: SimulationCapacity;
  /** Every input applied, every term held constant, every limitation. */
  readonly assumptions: readonly string[];
  /** Which figure came from which read. */
  readonly provenance: readonly string[];
  /** What the model cannot say, and why. */
  readonly unmodelled: readonly string[];
}
