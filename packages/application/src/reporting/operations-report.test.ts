import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import {
  OPERATIONS_REPORT_PRODUCTION_DRILLDOWN_NOTE,
  OPERATIONS_REPORT_PRODUCTION_YIELD_NOTE,
  OPERATIONS_REPORT_STOCK_VALUE_DRILLDOWN_NOTE,
  OPERATIONS_REPORT_STOCK_VALUE_NOTE,
  OPERATIONS_REPORT_TRUNCATED_NOTE,
  OPERATIONS_REPORT_VARIANCE_DRILLDOWN_NOTE,
  OPERATIONS_REPORT_VARIANCE_NOTE,
  OPERATIONS_REPORT_WASTE_DRILLDOWN_NOTE,
  OPERATIONS_REPORT_WASTE_STAGE_NOTE,
  OPERATIONS_REPORT_WASTE_VALUE_NOTE,
  buildOperationsReport,
  listOperationsReportRecords,
} from "./operations-report";
import { FakeReportingStore } from "./test-support";
import {
  OPERATIONS_REPORT_MAX_ROWS,
  type ProductionYieldRecordRow,
  type ProductionYieldRow,
  type StockCountVarianceRecordRow,
  type StockCountVarianceRow,
  type StockValueByLocationRow,
  type StockValueRecordRow,
  type WasteByStageRow,
  type WasteStageRecordRow,
} from "./types";

const ORG = "org-1";
const FROM = "2026-09-01T00:00:00.000Z";
const TO = "2026-09-30T23:59:59.000Z";
const AS_OF = "2026-09-30T23:59:59.000Z";

function store(): FakeReportingStore {
  return new FakeReportingStore();
}

function stockValue(overrides: Partial<StockValueByLocationRow> = {}): StockValueByLocationRow {
  return { locationId: "loc-1", locationName: "Oslo", valueOnHand: "1000.0000", ...overrides };
}

function stockVariance(overrides: Partial<StockCountVarianceRow> = {}): StockCountVarianceRow {
  return {
    locationId: "loc-1",
    locationName: "Oslo",
    counts: 2,
    varianceQty: "-3.500000",
    adjustmentValue: "-120.0000",
    ...overrides,
  };
}

function productionYield(overrides: Partial<ProductionYieldRow> = {}): ProductionYieldRow {
  return {
    locationId: "loc-1",
    locationName: "Oslo",
    recipeVersionId: "rv-1",
    recipeName: "Dough",
    batches: 3,
    plannedOutput: "100.000000",
    actualOutput: "90.000000",
    inputValue: "200.0000",
    outputValue: "180.0000",
    ...overrides,
  };
}

function wasteStage(overrides: Partial<WasteByStageRow> = {}): WasteByStageRow {
  return { stage: "preparation", events: 4, quantity: "2.500000", value: "30.0000", ...overrides };
}

describe("buildOperationsReport", () => {
  it("assembles the four sections, derives yield and carries the caveats", async () => {
    const fake = store();
    fake.seedStockValue(ORG, stockValue());
    fake.seedStockValue(
      ORG,
      stockValue({ locationId: "loc-2", locationName: "Bergen", valueOnHand: "250.0000" }),
    );
    fake.seedStockVariance(ORG, stockVariance());
    fake.seedProductionYield(ORG, productionYield());
    fake.seedWasteStage(ORG, "loc-1", wasteStage());
    fake.seedWasteStage(
      ORG,
      "loc-1",
      wasteStage({ stage: "storage_expiry", events: 1, quantity: "0.500000", value: null }),
    );

    const report = await buildOperationsReport(fake, {
      organizationId: ORG,
      from: FROM,
      to: TO,
      grain: "month",
      asOf: AS_OF,
    });

    expect(report.currency).toBe("NOK");
    expect(report.grain).toBe("month");
    expect(report.scope).toEqual({ locationIds: null });
    expect(report.period).toEqual({ from: FROM, to: TO });
    expect(report.truncated).toBe(false);

    expect(report.stockValue.asOf).toBe(AS_OF);
    expect(report.stockValue.total).toEqual({ valueOnHand: "1250.0000" });
    expect(report.stockValue.rows).toHaveLength(2);

    expect(report.stockVariance.totals).toEqual({
      counts: 2,
      varianceQty: "-3.500000",
      adjustmentValue: "-120.0000",
    });

    expect(report.production.rows[0]).toMatchObject({
      recipeVersionId: "rv-1",
      yieldVariancePct: "-0.100000",
      yieldRatio: "0.900000",
      inputValue: "200.0000",
      outputValue: "180.0000",
    });
    expect(report.production.totals).toMatchObject({
      batches: 3,
      yieldVariancePct: "-0.100000",
      yieldRatio: "0.900000",
    });

    expect(report.waste.totals).toEqual({
      events: 5,
      quantity: "3.000000",
      value: "30.0000",
    });

    for (const note of [
      OPERATIONS_REPORT_STOCK_VALUE_NOTE,
      OPERATIONS_REPORT_VARIANCE_NOTE,
      OPERATIONS_REPORT_PRODUCTION_YIELD_NOTE,
      OPERATIONS_REPORT_WASTE_STAGE_NOTE,
      OPERATIONS_REPORT_WASTE_VALUE_NOTE,
    ]) {
      expect(report.notes).toContain(note);
    }
  });

  it("returns null yield figures when planned output is non-positive", async () => {
    const fake = store();
    fake.seedProductionYield(
      ORG,
      productionYield({ plannedOutput: "0.000000", actualOutput: "0.000000" }),
    );

    const report = await buildOperationsReport(fake, {
      organizationId: ORG,
      from: FROM,
      to: TO,
      grain: "month",
      asOf: AS_OF,
    });

    expect(report.production.rows[0]?.yieldVariancePct).toBeNull();
    expect(report.production.rows[0]?.yieldRatio).toBeNull();
    expect(report.production.totals.yieldVariancePct).toBeNull();
    expect(report.production.totals.yieldRatio).toBeNull();
  });

  it("caps a section, flags truncation and still totals every row", async () => {
    const fake = store();
    for (let index = 0; index < OPERATIONS_REPORT_MAX_ROWS + 1; index += 1) {
      fake.seedStockValue(
        ORG,
        stockValue({
          locationId: `loc-${index}`,
          locationName: `Location ${index}`,
          valueOnHand: "1.0000",
        }),
      );
    }

    const report = await buildOperationsReport(fake, {
      organizationId: ORG,
      from: FROM,
      to: TO,
      grain: "month",
      asOf: AS_OF,
    });

    expect(report.truncated).toBe(true);
    expect(report.stockValue.rows).toHaveLength(OPERATIONS_REPORT_MAX_ROWS);
    expect(report.stockValue.total.valueOnHand).toBe(`${OPERATIONS_REPORT_MAX_ROWS + 1}.0000`);
    expect(report.notes).toContain(OPERATIONS_REPORT_TRUNCATED_NOTE);
  });

  it("normalizes an empty location scope to organization-wide and echoes a non-empty one", async () => {
    const fake = store();
    fake.seedStockValue(ORG, stockValue());

    const wide = await buildOperationsReport(fake, {
      organizationId: ORG,
      from: FROM,
      to: TO,
      grain: "month",
      asOf: AS_OF,
      locationIds: [],
    });
    expect(wide.scope.locationIds).toBeNull();

    const scoped = await buildOperationsReport(fake, {
      organizationId: ORG,
      from: FROM,
      to: TO,
      grain: "month",
      asOf: AS_OF,
      locationIds: ["loc-1"],
    });
    expect(scoped.scope.locationIds).toEqual(["loc-1"]);
  });

  it("scopes every section to the organization", async () => {
    const fake = store();
    fake.seedStockValue(ORG, stockValue());
    fake.seedStockValue("org-2", stockValue({ locationId: "other" }));

    const report = await buildOperationsReport(fake, {
      organizationId: ORG,
      from: FROM,
      to: TO,
      grain: "month",
      asOf: AS_OF,
    });

    expect(report.stockValue.rows.map((row) => row.locationId)).toEqual(["loc-1"]);
  });

  it("scopes the variance, production and waste aggregates to the organization", async () => {
    const fake = store();
    fake.seedStockVariance(ORG, stockVariance());
    fake.seedStockVariance("org-2", stockVariance({ locationId: "other", counts: 99 }));
    fake.seedProductionYield(ORG, productionYield());
    fake.seedProductionYield(
      "org-2",
      productionYield({ recipeVersionId: "rv-other", batches: 99 }),
    );
    fake.seedWasteStage(ORG, "loc-1", wasteStage());
    fake.seedWasteStage("org-2", "loc-1", wasteStage({ stage: "storage_expiry", events: 99 }));

    const report = await buildOperationsReport(fake, {
      organizationId: ORG,
      from: FROM,
      to: TO,
      grain: "month",
      asOf: AS_OF,
    });

    expect(report.stockVariance.rows.map((row) => row.locationId)).toEqual(["loc-1"]);
    expect(report.stockVariance.totals.counts).toBe(2);
    expect(report.production.rows.map((row) => row.recipeVersionId)).toEqual(["rv-1"]);
    expect(report.waste.rows.map((row) => row.stage)).toEqual(["preparation"]);
    expect(report.waste.totals.events).toBe(4);
  });

  it("scopes the waste section to the caller's locations", async () => {
    const fake = store();
    fake.seedWasteStage(ORG, "loc-1", wasteStage());
    fake.seedWasteStage(
      ORG,
      "loc-2",
      wasteStage({ stage: "storage_expiry", events: 2, quantity: "1.000000", value: "7.0000" }),
    );

    const report = await buildOperationsReport(fake, {
      organizationId: ORG,
      from: FROM,
      to: TO,
      grain: "month",
      asOf: AS_OF,
      locationIds: ["loc-1"],
    });

    expect(report.waste.rows.map((row) => row.stage)).toEqual(["preparation"]);
    expect(report.waste.totals).toEqual({ events: 4, quantity: "2.500000", value: "30.0000" });
  });

  it.each([
    ["organizationId", { organizationId: " " }],
    ["from", { from: "not-an-instant" }],
    ["to", { to: "not-an-instant" }],
    ["period order", { from: TO, to: FROM }],
    ["grain", { grain: "quarter" as never }],
    ["asOf", { asOf: "not-an-instant" }],
  ])("rejects a malformed %s", async (_label, overrides) => {
    const fake = store();
    await expect(
      buildOperationsReport(fake, {
        organizationId: ORG,
        from: FROM,
        to: TO,
        grain: "month",
        asOf: AS_OF,
        ...overrides,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

function stockValueRecord(overrides: Partial<StockValueRecordRow> = {}): StockValueRecordRow {
  return {
    id: "mv-1",
    occurredAt: "2026-09-10T12:00:00.000Z",
    locationId: "loc-1",
    locationName: "Oslo",
    itemId: "item-1",
    itemCode: "ING-1",
    itemName: "Flour",
    movementType: "receipt",
    quantityDelta: "5.000000",
    unitId: "unit-1",
    valueDelta: "50.0000",
    currency: "NOK",
    sourceType: "goods_receipt",
    sourceId: "receipt-1",
    ...overrides,
  };
}

function stockVarianceRecord(
  overrides: Partial<StockCountVarianceRecordRow> = {},
): StockCountVarianceRecordRow {
  return {
    id: "line-1",
    stockCountId: "count-1",
    cutoff: "2026-09-15T12:00:00.000Z",
    locationId: "loc-1",
    locationName: "Oslo",
    itemId: "item-1",
    itemCode: "ING-1",
    itemName: "Flour",
    storageAreaId: "area-1",
    lotId: null,
    expectedQty: "10.000000",
    countedQty: "9.000000",
    varianceQty: "-1.000000",
    reasonCode: "spillage",
    recount: false,
    ...overrides,
  };
}

function productionRecord(
  overrides: Partial<ProductionYieldRecordRow> = {},
): ProductionYieldRecordRow {
  return {
    id: "batch-1",
    locationId: "loc-1",
    locationName: "Oslo",
    recipeVersionId: "rv-1",
    recipeName: "Dough",
    status: "completed",
    actualStart: "2026-09-20T08:00:00.000Z",
    actualFinish: "2026-09-20T10:00:00.000Z",
    plannedOutputQty: "100.000000",
    actualOutputQty: "90.000000",
    yieldVariancePct: "-0.100000",
    ...overrides,
  };
}

function wasteRecord(overrides: Partial<WasteStageRecordRow> = {}): WasteStageRecordRow {
  return {
    id: "waste-1",
    occurredAt: "2026-09-12T12:00:00.000Z",
    locationId: "loc-1",
    locationName: "Oslo",
    stage: "preparation",
    reasonCode: "trim",
    itemId: "item-1",
    itemCode: "ING-1",
    itemName: "Flour",
    productVariantId: null,
    quantity: "0.500000",
    unitId: "unit-1",
    valueMethod: "moving_average",
    value: "5.0000",
    currency: "NOK",
    ...overrides,
  };
}

describe("listOperationsReportRecords", () => {
  it("returns the stock-value records filtered by the as-of instant, tagged by section", async () => {
    const fake = store();
    fake.seedStockValueRecord(ORG, "2026-09-10T12:00:00.000Z", stockValueRecord());
    fake.seedStockValueRecord(
      ORG,
      "2026-10-05T12:00:00.000Z",
      stockValueRecord({ id: "mv-future" }),
    );

    const page = await listOperationsReportRecords(fake, {
      organizationId: ORG,
      section: "stock_value",
      from: FROM,
      to: TO,
      grain: "month",
      asOf: AS_OF,
      limit: 10,
      offset: 0,
    });

    expect(page.section).toBe("stock_value");
    expect(page.records.map((record) => record.id)).toEqual(["mv-1"]);
    expect(page.records[0]?.section).toBe("stock_value");
    expect(page.truncated).toBe(false);
  });

  it("returns the stock-variance count lines in the half-open window", async () => {
    const fake = store();
    fake.seedStockCountVarianceRecord(ORG, "2026-09-15T12:00:00.000Z", stockVarianceRecord());
    fake.seedStockCountVarianceRecord(
      ORG,
      "2026-10-01T00:00:00.000Z",
      stockVarianceRecord({ id: "line-out" }),
    );

    const page = await listOperationsReportRecords(fake, {
      organizationId: ORG,
      section: "stock_variance",
      from: FROM,
      to: TO,
      grain: "month",
      limit: 10,
      offset: 0,
    });

    expect(page.records.map((record) => record.id)).toEqual(["line-1"]);
  });

  it("returns the completed batches in the half-open finish window", async () => {
    const fake = store();
    fake.seedProductionYieldRecord(ORG, "2026-09-20T10:00:00.000Z", productionRecord());
    fake.seedProductionYieldRecord(
      ORG,
      "2026-08-31T10:00:00.000Z",
      productionRecord({ id: "batch-out" }),
    );

    const page = await listOperationsReportRecords(fake, {
      organizationId: ORG,
      section: "production",
      from: FROM,
      to: TO,
      grain: "month",
      limit: 10,
      offset: 0,
    });

    expect(page.records.map((record) => record.id)).toEqual(["batch-1"]);
  });

  it("returns the waste events in the half-open window and flags truncation", async () => {
    const fake = store();
    fake.seedWasteStageRecord(ORG, "2026-09-12T12:00:00.000Z", wasteRecord());
    fake.seedWasteStageRecord(ORG, "2026-09-13T12:00:00.000Z", wasteRecord({ id: "waste-2" }));

    const page = await listOperationsReportRecords(fake, {
      organizationId: ORG,
      section: "waste",
      from: FROM,
      to: TO,
      grain: "month",
      limit: 1,
      offset: 0,
    });

    expect(page.records).toHaveLength(1);
    expect(page.records[0]?.section).toBe("waste");
    expect(page.truncated).toBe(true);
  });

  it("excludes a waste event exactly at the exclusive `to` bound", async () => {
    const fake = store();
    fake.seedWasteStageRecord(ORG, TO, wasteRecord({ id: "waste-at-to" }));
    fake.seedWasteStageRecord(ORG, "2026-09-29T12:00:00.000Z", wasteRecord({ id: "waste-in" }));

    const page = await listOperationsReportRecords(fake, {
      organizationId: ORG,
      section: "waste",
      from: FROM,
      to: TO,
      grain: "month",
      limit: 10,
      offset: 0,
    });

    expect(page.records.map((record) => record.id)).toEqual(["waste-in"]);
  });

  it("clamps a malformed limit or offset to its default", async () => {
    const fake = store();
    fake.seedWasteStageRecord(ORG, "2026-09-12T12:00:00.000Z", wasteRecord());

    for (const overrides of [
      { limit: 0, offset: -1 },
      { limit: -5, offset: -1 },
      { limit: 1.5, offset: 0.5 },
    ]) {
      const page = await listOperationsReportRecords(fake, {
        organizationId: ORG,
        section: "waste",
        from: FROM,
        to: TO,
        grain: "month",
        ...overrides,
      });

      expect(page.limit).toBe(100);
      expect(page.offset).toBe(0);
    }
  });

  it("carries the section-specific drill-down note", async () => {
    const fake = store();
    const cases = [
      ["stock_value", OPERATIONS_REPORT_STOCK_VALUE_DRILLDOWN_NOTE],
      ["stock_variance", OPERATIONS_REPORT_VARIANCE_DRILLDOWN_NOTE],
      ["production", OPERATIONS_REPORT_PRODUCTION_DRILLDOWN_NOTE],
      ["waste", OPERATIONS_REPORT_WASTE_DRILLDOWN_NOTE],
    ] as const;

    for (const [section, note] of cases) {
      const page = await listOperationsReportRecords(fake, {
        organizationId: ORG,
        section,
        from: FROM,
        to: TO,
        grain: "month",
      });

      expect(page.notes).toEqual([note]);
    }
  });

  it("defaults the stock-value drill-down to now when asOf is omitted", async () => {
    const fake = store();
    fake.seedStockValueRecord(ORG, "2020-01-01T00:00:00.000Z", stockValueRecord({ id: "mv-past" }));
    fake.seedStockValueRecord(
      ORG,
      "2099-01-01T00:00:00.000Z",
      stockValueRecord({ id: "mv-future" }),
    );

    const page = await listOperationsReportRecords(fake, {
      organizationId: ORG,
      section: "stock_value",
      from: FROM,
      to: TO,
      grain: "month",
      limit: 10,
      offset: 0,
    });

    expect(page.records.map((record) => record.id)).toEqual(["mv-past"]);
  });

  it("rejects an unknown section or a malformed period", async () => {
    const fake = store();
    await expect(
      listOperationsReportRecords(fake, {
        organizationId: ORG,
        section: "stock_turn" as never,
        from: FROM,
        to: TO,
        grain: "month",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      listOperationsReportRecords(fake, {
        organizationId: ORG,
        section: "waste",
        from: TO,
        to: FROM,
        grain: "month",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
