import {
  MENU_ENGINEERING_CONTRIBUTION_NOTE,
  MENU_ENGINEERING_THRESHOLD_NOTE,
  DomainError,
} from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import {
  MENU_ENGINEERING_CATEGORY_THRESHOLD_NOTE,
  MENU_ENGINEERING_MAX_ROWS,
  MENU_ENGINEERING_TRUNCATED_NOTE,
  MENU_ENGINEERING_UNMAPPED_NOTE,
  buildMenuEngineeringReport,
} from "./menu-engineering";
import { FakeReportingStore } from "./test-support";
import { SALES_REPORT_UNMAPPED_KEY, type SalesGroupRow } from "./types";

const ORG = "org-1";
const FROM = "2026-09-01T00:00:00.000Z";
const TO = "2026-09-30T23:59:59.000Z";

/** A pre-aggregated product group row with menu-engineering-relevant fields. */
function product(overrides: Partial<SalesGroupRow> = {}): SalesGroupRow {
  return {
    key: "variant-1",
    label: "Flat white",
    locationId: null,
    channelId: null,
    category: "coffee",
    productVariantId: "variant-1",
    productKind: "base",
    optionKinds: ["standalone"],
    periodBucket: "2026-09",
    transactions: 1,
    units: "1.000000",
    grossSales: "0.0000",
    netSales: "0.0000",
    taxAmount: "0.0000",
    discountAmount: "0.0000",
    refundAmount: "0.0000",
    ingredientCost: "0.0000",
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof buildMenuEngineeringReport>[1]> = {}) {
  return {
    organizationId: ORG,
    from: FROM,
    to: TO,
    grain: "month" as const,
    ...overrides,
  };
}

describe("buildMenuEngineeringReport", () => {
  it("computes the median thresholds and classifies each product", async () => {
    const fake = new FakeReportingStore();
    fake.seedGroup(
      ORG,
      product({
        key: "p1",
        productVariantId: "p1",
        label: "P1",
        units: "10.000000",
        netSales: "100.0000",
        ingredientCost: "40.0000",
      }),
    );
    fake.seedGroup(
      ORG,
      product({
        key: "p2",
        productVariantId: "p2",
        label: "P2",
        units: "4.000000",
        netSales: "80.0000",
        ingredientCost: "20.0000",
      }),
    );
    fake.seedGroup(
      ORG,
      product({
        key: "p3",
        productVariantId: "p3",
        label: "P3",
        category: "food",
        productKind: "add_on",
        optionKinds: ["attached"],
        units: "2.000000",
        netSales: "40.0000",
        ingredientCost: "10.0000",
      }),
    );
    fake.seedGroup(
      ORG,
      product({
        key: "p4",
        productVariantId: "p4",
        label: "P4",
        category: "food",
        units: "6.000000",
        netSales: "60.0000",
        ingredientCost: "50.0000",
      }),
    );

    const report = await buildMenuEngineeringReport(fake, input());

    // Even count: popularity median = (4 + 6) / 2 = 5.000000.
    expect(report.threshold.popularity).toMatchObject({
      statistic: "median",
      source: "computed",
      value: "5.000000",
      scope: { locationIds: null, channelId: null },
      sourcePeriod: { start: FROM, end: TO },
    });
    // Category-relative: no single value; each row carries its own category median.
    expect(report.threshold.contribution).toMatchObject({
      statistic: "category_median",
      source: "computed",
      value: null,
    });
    expect(report.currency).toBe("NOK");
    expect(report.grain).toBe("month");
    expect(report.truncated).toBe(false);
    expect(report.unmapped).toBeNull();

    const byId = new Map(report.rows.map((row) => [row.productVariantId, row]));
    // coffee median contribution = (60 + 60) / 2 = 60.0000.
    expect(byId.get("p1")).toMatchObject({
      units: "10.000000",
      contributionBeforeLabour: "60.0000",
      contributionThreshold: "60.0000",
      popularityHigh: true,
      contributionHigh: true,
      category: "coffee",
      productKind: "base",
      optionKinds: ["standalone"],
      waste: null,
    });
    expect(byId.get("p2")).toMatchObject({
      contributionBeforeLabour: "60.0000",
      popularityHigh: false,
      contributionHigh: true,
    });
    // food median contribution = (30 + 10) / 2 = 20.0000: P3 is high, P4 low.
    expect(byId.get("p3")).toMatchObject({
      contributionBeforeLabour: "30.0000",
      contributionThreshold: "20.0000",
      popularityHigh: false,
      contributionHigh: true,
      productKind: "add_on",
      optionKinds: ["attached"],
    });
    expect(byId.get("p4")).toMatchObject({
      contributionBeforeLabour: "10.0000",
      contributionThreshold: "20.0000",
      popularityHigh: true,
      contributionHigh: false,
    });
    expect(report.notes).toContain(MENU_ENGINEERING_THRESHOLD_NOTE);
    expect(report.notes).toContain(MENU_ENGINEERING_CONTRIBUTION_NOTE);
    expect(report.notes).toContain(MENU_ENGINEERING_CATEGORY_THRESHOLD_NOTE);
  });

  it("classifies a value exactly on the median as high", async () => {
    const fake = new FakeReportingStore();
    for (const [id, units, contribution] of [
      ["a", "4.000000", "10.0000"],
      ["b", "5.000000", "15.0000"],
      ["c", "6.000000", "20.0000"],
    ] as const) {
      fake.seedGroup(
        ORG,
        product({
          key: id,
          productVariantId: id,
          units,
          netSales: contribution,
          ingredientCost: "0.0000",
        }),
      );
    }

    const report = await buildMenuEngineeringReport(fake, input());

    // units median = 5.000000; contributions median = 15.0000.
    expect(report.threshold.popularity.value).toBe("5.000000");
    const byId = new Map(report.rows.map((row) => [row.productVariantId, row]));
    expect(byId.get("a")).toMatchObject({ popularityHigh: false, contributionHigh: false });
    expect(byId.get("b")).toMatchObject({
      popularityHigh: true,
      contributionHigh: true,
      contributionThreshold: "15.0000",
    });
    expect(byId.get("c")).toMatchObject({ popularityHigh: true, contributionHigh: true });
  });

  it("joins waste only for a variant named by a waste event", async () => {
    const fake = new FakeReportingStore();
    fake.seedGroup(ORG, product({ key: "p1", productVariantId: "p1", units: "1.000000" }));
    fake.seedGroup(ORG, product({ key: "p2", productVariantId: "p2", units: "3.000000" }));
    fake.seedWaste(ORG, "loc-1", "2026-09-10T12:00:00.000Z", {
      productVariantId: "p1",
      quantity: "1.500000",
      value: "12.0000",
    });
    // A waste event for another org must not leak in.
    fake.seedWaste("org-2", "loc-1", "2026-09-10T12:00:00.000Z", {
      productVariantId: "p1",
      quantity: "9.000000",
      value: "99.0000",
    });
    // A waste event outside the window must not leak in either.
    fake.seedWaste(ORG, "loc-1", "2026-08-10T12:00:00.000Z", {
      productVariantId: "p1",
      quantity: "5.000000",
      value: "50.0000",
    });

    const report = await buildMenuEngineeringReport(fake, input());

    const byId = new Map(report.rows.map((row) => [row.productVariantId, row]));
    expect(byId.get("p1")?.waste).toEqual({ quantity: "1.500000", value: "12.0000" });
    expect(byId.get("p2")?.waste).toBeNull();
  });

  it("carries a null waste value when no event was valued", async () => {
    const fake = new FakeReportingStore();
    fake.seedGroup(ORG, product({ key: "p1", productVariantId: "p1", units: "1.000000" }));
    fake.seedWaste(ORG, "loc-1", "2026-09-10T12:00:00.000Z", {
      productVariantId: "p1",
      quantity: "2.000000",
      value: null,
    });

    const report = await buildMenuEngineeringReport(fake, input());

    expect(report.rows[0]?.waste).toEqual({ quantity: "2.000000", value: null });
  });

  it("scopes waste to the queried location ids", async () => {
    const fake = new FakeReportingStore();
    fake.seedGroup(
      ORG,
      product({ key: "p1", productVariantId: "p1", locationId: "loc-1", units: "1.000000" }),
    );
    fake.seedWaste(ORG, "loc-1", "2026-09-10T12:00:00.000Z", {
      productVariantId: "p1",
      quantity: "1.000000",
      value: "5.0000",
    });
    // Another location's waste is out of the queried scope.
    fake.seedWaste(ORG, "loc-2", "2026-09-10T12:00:00.000Z", {
      productVariantId: "p1",
      quantity: "9.000000",
      value: "99.0000",
    });

    const report = await buildMenuEngineeringReport(fake, input({ locationIds: ["loc-1"] }));

    expect(report.rows[0]?.waste).toEqual({ quantity: "1.000000", value: "5.0000" });
  });

  it("carries the sorted distinct option kinds of a product", async () => {
    const fake = new FakeReportingStore();
    fake.seedGroup(
      ORG,
      product({
        key: "p1",
        productVariantId: "p1",
        optionKinds: ["standalone", "attached"],
        units: "1.000000",
      }),
    );

    const report = await buildMenuEngineeringReport(fake, input());

    expect(report.rows[0]?.optionKinds).toEqual(["attached", "standalone"]);
  });

  it("keeps the unmapped bucket out of the rows and thresholds", async () => {
    const fake = new FakeReportingStore();
    fake.seedGroup(ORG, product({ key: "p1", productVariantId: "p1", units: "10.000000" }));
    fake.seedGroup(
      ORG,
      product({
        key: SALES_REPORT_UNMAPPED_KEY,
        label: "Unmapped",
        productVariantId: null,
        category: null,
        productKind: null,
        optionKinds: [],
        units: "1000.000000",
        netSales: "500.0000",
      }),
    );

    const report = await buildMenuEngineeringReport(fake, input());

    expect(report.rows.map((row) => row.productVariantId)).toEqual(["p1"]);
    // A huge unmapped bucket must not move the single-product median.
    expect(report.threshold.popularity.value).toBe("10.000000");
    expect(report.unmapped).toEqual({ units: "1000.000000", netSales: "500.0000" });
    expect(report.notes).toContain(MENU_ENGINEERING_UNMAPPED_NOTE);
  });

  it("scopes rows and waste to the organization", async () => {
    const fake = new FakeReportingStore();
    fake.seedGroup(ORG, product({ key: "p1", productVariantId: "p1" }));
    fake.seedGroup("org-2", product({ key: "other", productVariantId: "other" }));

    const report = await buildMenuEngineeringReport(fake, input());

    expect(report.rows.map((row) => row.productVariantId)).toEqual(["p1"]);
    expect(report.threshold.popularity.value).toBe("1.000000");
  });

  it("caps the row list but still computes the thresholds over every product", async () => {
    const fake = new FakeReportingStore();
    for (let index = 0; index < MENU_ENGINEERING_MAX_ROWS + 1; index += 1) {
      fake.seedGroup(
        ORG,
        product({
          key: `p${index}`,
          productVariantId: `p${index}`,
          units: index === MENU_ENGINEERING_MAX_ROWS ? "5.000000" : "1.000000",
        }),
      );
    }

    const report = await buildMenuEngineeringReport(fake, input());

    expect(report.truncated).toBe(true);
    expect(report.rows).toHaveLength(MENU_ENGINEERING_MAX_ROWS);
    expect(report.notes).toContain(MENU_ENGINEERING_TRUNCATED_NOTE);
    // 500 products at 1.000000 and one at 5.000000: the median is 1.000000,
    // computed over all 501, not over the truncated slice.
    expect(report.threshold.popularity.value).toBe("1.000000");
  });

  it("echoes the location scope and passes it to both reads", async () => {
    const fake = new FakeReportingStore();
    fake.seedGroup(
      ORG,
      product({
        key: "p1",
        productVariantId: "p1",
        locationId: "loc-1",
        channelId: "chan-1",
        units: "1.000000",
      }),
    );

    const report = await buildMenuEngineeringReport(
      fake,
      input({ locationIds: ["loc-1"], channelId: "chan-1" }),
    );

    expect(report.scope).toEqual({ locationIds: ["loc-1"], channelId: "chan-1" });
    expect(report.threshold.popularity.scope).toEqual({
      locationIds: ["loc-1"],
      channelId: "chan-1",
    });
  });

  it.each([
    ["organizationId", { organizationId: " " }],
    ["from", { from: "not-an-instant" }],
    ["to", { to: "not-an-instant" }],
    ["period order", { from: TO, to: FROM }],
    ["grain", { grain: "quarter" as never }],
  ])("rejects a malformed %s", async (_label, overrides) => {
    const fake = new FakeReportingStore();
    await expect(buildMenuEngineeringReport(fake, input(overrides))).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});
