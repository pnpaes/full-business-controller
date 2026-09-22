import { DomainError, netSalesFromLine } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import {
  buildSalesReport,
  SALES_REPORT_CONTRIBUTION_NOTE,
  SALES_REPORT_TRUNCATED_NOTE,
  SALES_REPORT_UNMAPPED_NOTE,
} from "./build-sales-report";
import {
  listSalesReportRecords,
  SALES_REPORT_DRILLDOWN_INCLUDED_NOTE,
} from "./list-sales-report-records";
import { FakeReportingStore } from "./test-support";
import { SALES_REPORT_MAX_GROUPS, type SalesGroupRow, type SalesReportLineRow } from "./types";

const ORG = "org-1";
const ACTOR = "actor-1";
const FROM = "2026-09-01T00:00:00.000Z";
const TO = "2026-09-30T23:59:59.000Z";

function group(overrides: Partial<SalesGroupRow> = {}): SalesGroupRow {
  return {
    key: "loc-1",
    label: "Oslo",
    locationId: "loc-1",
    channelId: null,
    category: null,
    productVariantId: null,
    productKind: null,
    optionKinds: [],
    periodBucket: "2026-09",
    transactions: 2,
    units: "3.000000",
    grossSales: "125.0000",
    netSales: "100.0000",
    taxAmount: "25.0000",
    discountAmount: "0.0000",
    refundAmount: "0.0000",
    ingredientCost: "32.5000",
    ...overrides,
  };
}

function line(overrides: Partial<SalesReportLineRow> = {}): SalesReportLineRow {
  return {
    id: "line-1",
    salesTransactionId: "txn-1",
    occurredAt: "2026-09-10T12:00:00.000Z",
    locationId: "loc-1",
    channelId: null,
    category: null,
    productVariantId: null,
    sku: null,
    externalProductRef: null,
    externalLineId: null,
    optionKind: "standalone",
    quantity: "1.000000",
    grossAmount: "125.0000",
    netAmount: null,
    taxAmount: "25.0000",
    discountAmount: null,
    refundAmount: null,
    ingredientCost: "32.5000",
    reversalOfId: null,
    ...overrides,
  };
}

function store(): FakeReportingStore {
  return new FakeReportingStore();
}

describe("buildSalesReport", () => {
  it("builds groups with contribution and totals", async () => {
    const fake = store();
    fake.seedGroup(ORG, group());
    fake.seedGroup(
      ORG,
      group({
        key: "loc-2",
        label: "Bergen",
        locationId: "loc-2",
        netSales: "50.0000",
        grossSales: "62.5000",
        ingredientCost: "20.0000",
        transactions: 1,
        units: "1.500000",
      }),
    );

    const report = await buildSalesReport(fake, {
      organizationId: ORG,
      actorId: ACTOR,
      from: FROM,
      to: TO,
      grain: "month",
      groupBy: "location",
    });

    expect(report.currency).toBe("NOK");
    expect(report.grain).toBe("month");
    expect(report.groupBy).toBe("location");
    expect(report.scope).toEqual({
      locationIds: null,
      channelId: null,
      category: null,
      productVariantId: null,
    });
    expect(report.period).toEqual({ from: FROM, to: TO });
    expect(report.truncated).toBe(false);
    expect(report.groups).toHaveLength(2);
    expect(report.groups[0]).toMatchObject({
      key: "loc-1",
      label: "Oslo",
      contributionBeforeLabour: "67.5000",
      contributionMarginPct: "67.500000",
    });
    expect(report.totals).toMatchObject({
      transactions: 3,
      units: "4.500000",
      netSales: "150.0000",
      grossSales: "187.5000",
      ingredientCost: "52.5000",
      contributionBeforeLabour: "97.5000",
      contributionMarginPct: "65.000000",
    });
    expect(report.notes).toContain(SALES_REPORT_CONTRIBUTION_NOTE);
  });

  it("returns a null margin when net sales are non-positive (DEC-063)", async () => {
    const fake = store();
    fake.seedGroup(ORG, group({ netSales: "0.0000", ingredientCost: "5.0000" }));

    const report = await buildSalesReport(fake, {
      organizationId: ORG,
      actorId: ACTOR,
      from: FROM,
      to: TO,
      grain: "month",
      groupBy: "location",
    });

    expect(report.groups[0]?.contributionMarginPct).toBeNull();
    expect(report.totals.contributionMarginPct).toBeNull();
  });

  it("caveats an unmapped group and totals its measures", async () => {
    const fake = store();
    fake.seedGroup(
      ORG,
      group({
        key: "unmapped",
        label: "Unmapped",
        locationId: null,
        productVariantId: null,
        netSales: "45.0000",
        grossSales: "50.0000",
        ingredientCost: "10.0000",
        transactions: 1,
      }),
    );

    const report = await buildSalesReport(fake, {
      organizationId: ORG,
      actorId: ACTOR,
      from: FROM,
      to: TO,
      grain: "month",
      groupBy: "product",
    });

    expect(report.notes).toContain(SALES_REPORT_UNMAPPED_NOTE);
    expect(report.groups[0]).toMatchObject({ key: "unmapped", netSales: "45.0000" });
    expect(report.totals).toMatchObject({
      transactions: 1,
      netSales: "45.0000",
      ingredientCost: "10.0000",
      contributionBeforeLabour: "35.0000",
    });
  });

  it("flags and notes a truncated group list but keeps totals over every group", async () => {
    const fake = store();
    for (let index = 0; index < SALES_REPORT_MAX_GROUPS + 1; index += 1) {
      fake.seedGroup(
        ORG,
        group({ key: `loc-${index}`, label: `Location ${index}`, locationId: `loc-${index}` }),
      );
    }

    const report = await buildSalesReport(fake, {
      organizationId: ORG,
      actorId: ACTOR,
      from: FROM,
      to: TO,
      grain: "month",
      groupBy: "location",
    });

    expect(report.truncated).toBe(true);
    expect(report.groups).toHaveLength(SALES_REPORT_MAX_GROUPS);
    expect(report.notes).toContain(SALES_REPORT_TRUNCATED_NOTE);
    // The totals are summed over every group, not the truncated slice.
    expect(report.totals.netSales).toBe(
      (BigInt(SALES_REPORT_MAX_GROUPS + 1) * 100n).toString() + ".0000",
    );
  });

  it("scopes rows to the organization", async () => {
    const fake = store();
    fake.seedGroup(ORG, group());
    fake.seedGroup("org-2", group({ key: "other", label: "Other" }));

    const report = await buildSalesReport(fake, {
      organizationId: ORG,
      actorId: ACTOR,
      from: FROM,
      to: TO,
      grain: "month",
      groupBy: "location",
    });

    expect(report.groups.map((row) => row.key)).toEqual(["loc-1"]);
  });

  it("passes a location scope through to the store and echoes it", async () => {
    const fake = store();
    fake.seedGroup(ORG, group({ key: "loc-1", locationId: "loc-1" }));
    fake.seedGroup(ORG, group({ key: "loc-2", label: "Bergen", locationId: "loc-2" }));

    const report = await buildSalesReport(fake, {
      organizationId: ORG,
      actorId: ACTOR,
      from: FROM,
      to: TO,
      grain: "month",
      groupBy: "location",
      locationIds: ["loc-2"],
    });

    expect(report.scope.locationIds).toEqual(["loc-2"]);
    expect(report.groups.map((row) => row.key)).toEqual(["loc-2"]);
  });

  it.each([
    ["organizationId", { organizationId: " " }],
    ["actorId", { actorId: "" }],
    ["from", { from: "not-an-instant" }],
    ["to", { to: "not-an-instant" }],
    ["period order", { from: TO, to: FROM }],
    ["grain", { grain: "quarter" as never }],
    ["groupBy", { groupBy: "sku" as never }],
  ])("rejects a malformed %s", async (_label, overrides) => {
    const fake = store();
    await expect(
      buildSalesReport(fake, {
        organizationId: ORG,
        actorId: ACTOR,
        from: FROM,
        to: TO,
        grain: "month",
        groupBy: "location",
        ...overrides,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe("listSalesReportRecords", () => {
  it("resolves net sales from the source preference and passes paging through", async () => {
    const fake = store();
    fake.seedLine(ORG, line({ id: "line-a", occurredAt: "2026-09-02T12:00:00.000Z" }));
    fake.seedLine(
      ORG,
      line({
        id: "line-b",
        occurredAt: "2026-09-03T12:00:00.000Z",
        netAmount: "99.0000",
      }),
    );

    const page = await listSalesReportRecords(fake, {
      organizationId: ORG,
      actorId: ACTOR,
      from: FROM,
      to: TO,
      grain: "month",
      limit: 10,
      offset: 0,
    });

    expect(page.currency).toBe("NOK");
    expect(page.truncated).toBe(false);
    expect(page.records).toHaveLength(2);
    // line-a has no net_amount: derived as gross − tax, exactly the domain value.
    expect(page.records[0]?.netSales).toBe(
      netSalesFromLine({
        grossAmount: "125.0000",
        taxAmount: "25.0000",
        discountAmount: null,
        refundAmount: null,
        netAmount: null,
      }),
    );
    expect(page.records[0]?.netSales).toBe("100.0000");
    // line-b uses the reported net amount, exactly the domain value.
    expect(page.records[1]?.netSales).toBe(
      netSalesFromLine({
        grossAmount: "125.0000",
        taxAmount: "25.0000",
        discountAmount: null,
        refundAmount: null,
        netAmount: "99.0000",
      }),
    );
    expect(page.records[1]?.netSales).toBe("99.0000");
  });

  it("excludes included lines and says so in the notes (SALE-011)", async () => {
    const fake = store();
    fake.seedLine(ORG, line({ id: "line-a" }));
    fake.seedLine(ORG, line({ id: "line-included", optionKind: "included" }));

    const page = await listSalesReportRecords(fake, {
      organizationId: ORG,
      actorId: ACTOR,
      from: FROM,
      to: TO,
      grain: "month",
      limit: 10,
    });

    expect(page.records.map((record) => record.id)).toEqual(["line-a"]);
    expect(page.notes).toContain(SALES_REPORT_DRILLDOWN_INCLUDED_NOTE);
  });

  it("flags truncation and pages by offset", async () => {
    const fake = store();
    fake.seedLine(ORG, line({ id: "line-a", occurredAt: "2026-09-02T12:00:00.000Z" }));
    fake.seedLine(ORG, line({ id: "line-b", occurredAt: "2026-09-03T12:00:00.000Z" }));

    const page = await listSalesReportRecords(fake, {
      organizationId: ORG,
      actorId: ACTOR,
      from: FROM,
      to: TO,
      grain: "month",
      limit: 1,
      offset: 0,
    });

    expect(page.records).toHaveLength(1);
    expect(page.records[0]?.id).toBe("line-a");
    expect(page.truncated).toBe(true);
  });

  it("excludes lines outside the window and other organizations", async () => {
    const fake = store();
    fake.seedLine(ORG, line({ id: "in-window" }));
    fake.seedLine(ORG, line({ id: "out-of-window", occurredAt: "2026-08-31T23:59:59.000Z" }));
    fake.seedLine("org-2", line({ id: "other-org" }));

    const page = await listSalesReportRecords(fake, {
      organizationId: ORG,
      actorId: ACTOR,
      from: FROM,
      to: TO,
      grain: "month",
      limit: 10,
    });

    expect(page.records.map((record) => record.id)).toEqual(["in-window"]);
  });

  it("rejects a malformed period or grain", async () => {
    const fake = store();
    await expect(
      listSalesReportRecords(fake, {
        organizationId: ORG,
        actorId: ACTOR,
        from: TO,
        to: FROM,
        grain: "month",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      listSalesReportRecords(fake, {
        organizationId: ORG,
        actorId: ACTOR,
        from: FROM,
        to: TO,
        grain: "quarter" as never,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
