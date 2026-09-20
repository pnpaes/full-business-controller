import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { computeCostCardTotals } from "./cost-card";
import { computeLandedCost } from "./landed-cost";
import { directLaborCost } from "./labour";
import {
  channelVariableCost,
  contributionMarginPct,
  netFromGross,
  unitContribution,
  unitVariableCost,
} from "./pricing";
import { Quantity } from "./quantity";
import { computeRecipeCost, lineCost } from "./recipe";
import { SupplierPack } from "./supplier-pack";
import { Unit, type UnitDimension } from "./unit";

/**
 * Reconciles the machine-readable golden fixtures (`tests/fixtures/*.json`,
 * `DEC-065`) against the `@aquarela/domain` primitives. The fixtures are JSON,
 * so no YAML dependency is added; every expected number that this package can
 * compute is derived here rather than trusted.
 */

const FIXTURE_IDS = [
  "cheese_bun",
  "coffee_drink",
  "acai_medium_takeaway",
  "cake_slice",
  "quiche_slice",
  "chicken_pie",
] as const;
type FixtureId = (typeof FIXTURE_IDS)[number];

const REQUIRED_KEYS = [
  "id",
  "version",
  "status",
  "signed_by",
  "signed_at",
  "source_refs",
  "tax_basis",
  "currency",
  "supplier_packs",
  "recipe",
  "labor",
  "packaging",
  "channel",
  "expected",
  "rounding",
] as const;

const STATUSES: readonly string[] = ["unsigned", "illustrative", "signed"];

interface SupplierPackFixture {
  readonly item_code: string;
  readonly pack_unit: string;
  readonly base_unit: string;
  readonly pack_to_base_factor: string;
  readonly gross_pack_price: string;
  readonly discount: string;
  readonly recoverable_tax: string;
  readonly freight: string;
  readonly import_fee: string;
  readonly tax_basis: string;
}

interface RecipeLineFixture {
  readonly component: string;
  readonly qty: string;
  readonly unit: string;
  readonly loss_factor: string;
}

interface ChannelFixture {
  readonly channel: string;
  readonly gross_price: string;
  readonly tax_rate_pct: string;
  readonly fee_basis: string;
  readonly commission_pct: string;
  readonly packaging_cost?: string;
}

interface Fixture {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly signed_by: string[];
  readonly signed_at: string | null;
  readonly source_refs: string[];
  readonly tax_basis: string | null;
  readonly currency: string;
  readonly supplier_packs: SupplierPackFixture[];
  readonly recipe: {
    readonly kind: string | null;
    readonly planned_input_qty: string | null;
    readonly approved_usable_output: string | null;
    readonly planned_output_qty: string | null;
    readonly lines: RecipeLineFixture[];
  };
  readonly labor: {
    readonly loaded_hourly_rate: string | null;
    readonly productive_minutes_per_unit: string | null;
  };
  readonly packaging: { readonly component: string; readonly qty: string; readonly unit: string }[];
  readonly channel: ChannelFixture[];
  readonly expected: Record<string, unknown>;
  readonly rounding: {
    readonly method: string;
    readonly scales: { readonly qty: number; readonly money: number; readonly presented: number };
  };
}

interface CheeseBunExpected {
  readonly B1_landed_base_unit_cost: Record<string, string>;
  readonly B2_line_cost: Record<string, string>;
  readonly B3_cost_per_usable_output_unit: string;
  readonly ingredient_cost: string;
  readonly packaging_cost: string;
  readonly direct_labor_cost: string;
  readonly unit_variable_cost_before_labor: string;
  readonly unit_variable_cost_after_labor: string;
  readonly unit_net_sales: string;
  readonly contribution_before_direct_labor: string;
  readonly contribution_after_direct_labor: string;
  readonly contribution_margin_pct: string;
  readonly contribution_margin_pct_before_labor: string;
}

interface CoffeeExpected {
  readonly ingredient_cost: string;
  readonly direct_labor_cost: string;
  readonly unit_net_sales: Record<string, string>;
  readonly channel_fee: Record<string, string>;
  readonly unit_variable_cost_before_labor: Record<string, string>;
  readonly unit_variable_cost_after_labor: Record<string, string>;
  readonly contribution_after_direct_labor: Record<string, string>;
  readonly contribution_margin_pct: Record<string, string>;
}

function loadFixture(id: FixtureId): Fixture {
  const path = new URL(`../../../tests/fixtures/${id}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

function required(value: string | null | undefined, field: string): string {
  if (value === null || value === undefined) {
    throw new Error(`fixture field "${field}" is not populated`);
  }
  return value;
}

function first<T>(items: readonly T[], field: string): T {
  const item = items[0];
  if (item === undefined) {
    throw new Error(`fixture field "${field}" is empty`);
  }
  return item;
}

const BASE_UNIT_DIMENSIONS: Readonly<Record<string, UnitDimension>> = {
  g: "mass",
  ml: "volume",
  pc: "count",
};

function supplierPack(pack: SupplierPackFixture): SupplierPack {
  const dimension = BASE_UNIT_DIMENSIONS[pack.base_unit];
  if (dimension === undefined) {
    throw new Error(`unknown fixture base unit "${pack.base_unit}"`);
  }
  return SupplierPack.from(
    Unit.from(pack.pack_unit, "package"),
    Unit.from(pack.base_unit, dimension, true),
    pack.pack_to_base_factor,
  );
}

describe("golden fixtures", () => {
  it("every fixture has the required keys, a positive integer version and an allowed status", () => {
    for (const id of FIXTURE_IDS) {
      const fixture = loadFixture(id);

      expect(fixture.id).toBe(id);
      for (const key of REQUIRED_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(fixture, key)).toBe(true);
      }
      expect(Number.isInteger(fixture.version)).toBe(true);
      expect(fixture.version).toBeGreaterThan(0);
      expect(STATUSES).toContain(fixture.status);
    }
  });

  it("a fixture claims signatories only when its status is signed", () => {
    for (const id of FIXTURE_IDS) {
      const fixture = loadFixture(id);

      if (fixture.status === "signed") {
        expect(fixture.signed_by.length).toBeGreaterThan(0);
        expect(fixture.signed_at).not.toBeNull();
      } else {
        expect(fixture.signed_by).toEqual([]);
        expect(fixture.signed_at).toBeNull();
      }
    }
  });

  it("unsigned fixtures carry no expected values", () => {
    for (const id of FIXTURE_IDS) {
      const fixture = loadFixture(id);

      if (fixture.status === "unsigned") {
        expect(fixture.expected).toEqual({});
      }
    }
  });

  it("defers cost-source-resolved inputs to the application layer", () => {
    // ponytail: a signed fixture's supplier pack prices and ingredient costs come
    // from the DEC-047 cost-source precedence (latest receipt vs standard cost),
    // which is resolved in @aquarela/application — out of reach of this domain
    // test. The fixture already carries the illustrative resolved numbers, so we
    // assert only their presence instead of re-implementing source selection.
    // Ceiling: raise this when the application-layer cost-card reconciliation
    // test lands; do not import from @aquarela/application here.
    for (const id of ["cheese_bun", "coffee_drink"] as const) {
      expect(typeof loadFixture(id).expected.ingredient_cost).toBe("string");
    }
  });
});

describe("cheese_bun fixture", () => {
  it("reconciles every supplier pack's landed base-unit cost (B1)", () => {
    const fixture = loadFixture("cheese_bun");
    const expected = fixture.expected as unknown as CheeseBunExpected;
    expect(fixture.supplier_packs).toHaveLength(7);

    for (const pack of fixture.supplier_packs) {
      const landed = computeLandedCost({
        grossPackPrice: pack.gross_pack_price,
        discount: pack.discount,
        recoverableTax: pack.recoverable_tax,
        allocatedFreight: pack.freight,
        importFee: pack.import_fee,
        currency: fixture.currency,
        acceptedPackQuantity: Quantity.from("1", pack.pack_unit),
        pack: supplierPack(pack),
      });

      expect(landed.landedBaseUnitCost).toBe(expected.B1_landed_base_unit_cost[pack.item_code]);
    }
  });

  it("reconciles the recipe line costs (B2) and B3 through lineCost/computeRecipeCost", () => {
    const fixture = loadFixture("cheese_bun");
    const expected = fixture.expected as unknown as CheeseBunExpected;

    const lineCosts: { lineCost: string }[] = [];
    for (const line of fixture.recipe.lines) {
      const unitCost = required(
        expected.B1_landed_base_unit_cost[line.component],
        `expected.B1_landed_base_unit_cost.${line.component}`,
      );
      const cost = lineCost(line.qty, unitCost, fixture.currency);
      expect(cost).toBe(expected.B2_line_cost[line.component]);
      lineCosts.push({ lineCost: cost });
    }

    const recipeCost = computeRecipeCost({
      currency: fixture.currency,
      lines: lineCosts,
      approvedUsableOutput: required(
        fixture.recipe.approved_usable_output,
        "recipe.approved_usable_output",
      ),
    });
    expect(recipeCost.recipeInputCost).toBe("294.0000");
    expect(recipeCost.costPerUsableOutputUnit).toBe(expected.B3_cost_per_usable_output_unit);
    expect(recipeCost.costPerUsableOutputUnit).toBe(expected.ingredient_cost);
  });

  it("reconciles net sales, labour, variable cost, contributions and margin", () => {
    const fixture = loadFixture("cheese_bun");
    const expected = fixture.expected as unknown as CheeseBunExpected;
    const channel = first(fixture.channel, "channel");

    const netSales = netFromGross(channel.gross_price, channel.tax_rate_pct);
    expect(netSales).toBe(expected.unit_net_sales);

    const laborCost = directLaborCost(
      required(fixture.labor.productive_minutes_per_unit, "labor.productive_minutes_per_unit"),
      required(fixture.labor.loaded_hourly_rate, "labor.loaded_hourly_rate"),
    );
    expect(laborCost).toBe(expected.direct_labor_cost);

    const variableBeforeLabor = unitVariableCost({
      ingredientCost: expected.ingredient_cost,
      packagingCost: expected.packaging_cost,
      channelVariableCost: "0",
      otherVariableCost: "0",
    });
    expect(variableBeforeLabor).toBe(expected.unit_variable_cost_before_labor);

    const contributionBefore = unitContribution(netSales, variableBeforeLabor);
    const contributionAfter = unitContribution(netSales, expected.unit_variable_cost_after_labor);
    expect(contributionBefore).toBe(expected.contribution_before_direct_labor);
    expect(contributionAfter).toBe(expected.contribution_after_direct_labor);
    expect(contributionMarginPct(netSales, contributionAfter)).toBe(
      expected.contribution_margin_pct,
    );
    expect(contributionMarginPct(netSales, contributionBefore)).toBe(
      expected.contribution_margin_pct_before_labor,
    );

    const totals = computeCostCardTotals({
      currency: fixture.currency,
      ingredientCost: expected.ingredient_cost,
      packagingCost: expected.packaging_cost,
      directLaborCost: laborCost,
      channelVariableCost: "0",
      otherVariableCost: "0",
      unitNetSales: netSales,
      allocatedUnitOverhead: "0",
    });
    expect(totals.unitVariableCost).toBe(expected.unit_variable_cost_after_labor);
    expect(totals.contributionAfterDirectLabor).toBe(expected.contribution_after_direct_labor);
    expect(totals.contributionMarginPctAfterLabor).toBe(expected.contribution_margin_pct);
  });
});

describe("coffee_drink fixture", () => {
  it("reconciles per-channel net prices, fees, variable costs, contributions and margins", () => {
    const fixture = loadFixture("coffee_drink");
    const expected = fixture.expected as unknown as CoffeeExpected;

    const laborCost = directLaborCost(
      required(fixture.labor.productive_minutes_per_unit, "labor.productive_minutes_per_unit"),
      required(fixture.labor.loaded_hourly_rate, "labor.loaded_hourly_rate"),
    );
    expect(laborCost).toBe(expected.direct_labor_cost);
    expect(fixture.channel).toHaveLength(3);

    for (const channel of fixture.channel) {
      const netSales = netFromGross(channel.gross_price, channel.tax_rate_pct);
      expect(netSales).toBe(expected.unit_net_sales[channel.channel]);

      const fee = channelVariableCost({
        percentageFeeRate: channel.commission_pct,
        feeBasisAmount: netSales,
      });
      expect(fee).toBe(expected.channel_fee[channel.channel]);

      const packagingCost = required(
        channel.packaging_cost,
        `channel.${channel.channel}.packaging_cost`,
      );
      const variableBeforeLabor = unitVariableCost({
        ingredientCost: expected.ingredient_cost,
        packagingCost,
        channelVariableCost: fee,
        otherVariableCost: "0",
      });
      expect(variableBeforeLabor).toBe(expected.unit_variable_cost_before_labor[channel.channel]);

      const totals = computeCostCardTotals({
        currency: fixture.currency,
        ingredientCost: expected.ingredient_cost,
        packagingCost,
        directLaborCost: laborCost,
        channelVariableCost: fee,
        otherVariableCost: "0",
        unitNetSales: netSales,
        allocatedUnitOverhead: "0",
      });
      expect(totals.unitVariableCost).toBe(
        expected.unit_variable_cost_after_labor[channel.channel],
      );
      expect(totals.contributionAfterDirectLabor).toBe(
        expected.contribution_after_direct_labor[channel.channel],
      );
      expect(contributionMarginPct(netSales, totals.contributionAfterDirectLabor)).toBe(
        expected.contribution_margin_pct[channel.channel],
      );
      expect(unitContribution(netSales, totals.unitVariableCost)).toBe(
        expected.contribution_after_direct_labor[channel.channel],
      );
    }

    expect(expected.unit_net_sales["wolt"]).toBe("53.9130");
    expect(expected.channel_fee["wolt"]).toBe("16.1739");
  });
});
