import type { SalesLineRecord, SalesTransactionRecord } from "@aquarela/application";
import { describe, expect, it } from "vitest";

import {
  parsePostImportRunBody,
  parsePostTheoreticalConsumptionBody,
  parseReverseSalesLineBody,
  parseSalesTransactionListQuery,
  toSalesLineRows,
  toSalesTransactionRows,
  type SalesRefs,
} from "./sales-rows";

const ORG = "org-1";
const OTHER = "org-2";
const LOC = "11111111-1111-4111-8111-111111111111";
const CHANNEL = "22222222-2222-4222-8222-222222222222";
const AREA = "33333333-3333-4333-8333-333333333333";

function transaction(overrides: Partial<SalesTransactionRecord> = {}): SalesTransactionRecord {
  return {
    id: "txn-1",
    organizationId: ORG,
    locationId: LOC,
    channelId: CHANNEL,
    sourceSystem: "zettle-legacy",
    externalTransactionId: "R-1001",
    occurredAt: "2026-08-01T12:15:00.000Z",
    grossAmount: "377.0000",
    netAmount: "301.6000",
    taxAmount: "75.4000",
    discountAmount: "10.0000",
    refundAmount: null,
    currency: "NOK",
    importRunId: "run-1",
    ...overrides,
  };
}

function line(overrides: Partial<SalesLineRecord> = {}): SalesLineRecord {
  return {
    id: "line-1",
    organizationId: ORG,
    salesTransactionId: "txn-1",
    productVariantId: null,
    externalProductRef: "Demo Espresso Beans",
    sku: "DEMO-SKU-ESPRESSO",
    externalLineId: "R-1001#2",
    quantity: "1.000000",
    unitPrice: "129.0000",
    grossAmount: "129.0000",
    netAmount: "103.2000",
    taxAmount: "25.8000",
    appliedTaxRate: "0.250000",
    discountAmount: "0.0000",
    refundAmount: null,
    channelId: null,
    taxRuleId: null,
    parentLineId: null,
    optionKind: "standalone",
    channelFeeBasis: null,
    mappingState: "mapped",
    reversalOfId: null,
    ...overrides,
  };
}

const REFS: SalesRefs = {
  locations: new Map([[LOC, { code: "DEMO_CAFE", name: "Demo Café Oslo" }]]),
  channels: new Map([[CHANNEL, { code: "WOLT", name: "Wolt" }]]),
};

describe("parseSalesTransactionListQuery", () => {
  it("defaults the page and leaves the filters unset", () => {
    const parsed = parseSalesTransactionListQuery(new URLSearchParams());
    expect(parsed).toEqual({
      ok: true,
      query: { limit: 50, offset: 0 },
    });
  });

  it("accepts a source, a location and paging", () => {
    const parsed = parseSalesTransactionListQuery(
      new URLSearchParams({
        sourceSystem: " zettle-legacy ",
        locationId: LOC,
        limit: "10",
        offset: "5",
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      query: { sourceSystem: "zettle-legacy", locationId: LOC, limit: 10, offset: 5 },
    });
  });

  it("rejects a malformed location, a non-numeric limit and an out-of-range limit", () => {
    expect(parseSalesTransactionListQuery(new URLSearchParams({ locationId: "nope" })).ok).toBe(
      false,
    );
    expect(parseSalesTransactionListQuery(new URLSearchParams({ limit: "abc" })).ok).toBe(false);
    expect(parseSalesTransactionListQuery(new URLSearchParams({ limit: "0" })).ok).toBe(false);
    expect(parseSalesTransactionListQuery(new URLSearchParams({ limit: "201" })).ok).toBe(false);
  });
});

describe("parsePostImportRunBody", () => {
  it("treats an absent body or blank source as the run's own source", () => {
    expect(parsePostImportRunBody(undefined)).toEqual({ ok: true, sourceSystem: null });
    expect(parsePostImportRunBody({ sourceSystem: "   " })).toEqual({
      ok: true,
      sourceSystem: null,
    });
  });

  it("trims a supplied source and rejects a non-string", () => {
    expect(parsePostImportRunBody({ sourceSystem: " front " })).toEqual({
      ok: true,
      sourceSystem: "front",
    });
    expect(parsePostImportRunBody({ sourceSystem: 42 })).toEqual({ ok: false });
  });
});

describe("parsePostTheoreticalConsumptionBody", () => {
  it("parses a valid body and defaults the override off", () => {
    const parsed = parsePostTheoreticalConsumptionBody({
      locationId: LOC,
      occurredOn: "2026-08-01",
      storageAreaId: AREA,
    });
    expect(parsed).toEqual({
      ok: true,
      input: {
        locationId: LOC,
        occurredOn: "2026-08-01",
        storageAreaId: AREA,
        idempotencyKey: null,
        allowNegativeOverride: false,
      },
    });
  });

  it("rejects a missing location, a non-uuid area, a bad date and a bad override", () => {
    expect(
      parsePostTheoreticalConsumptionBody({
        occurredOn: "2026-08-01",
        storageAreaId: AREA,
      }).ok,
    ).toBe(false);
    expect(
      parsePostTheoreticalConsumptionBody({
        locationId: LOC,
        occurredOn: "2026-08-01",
        storageAreaId: "nope",
      }).ok,
    ).toBe(false);
    expect(
      parsePostTheoreticalConsumptionBody({
        locationId: LOC,
        occurredOn: "01-08-2026",
        storageAreaId: AREA,
      }).ok,
    ).toBe(false);
    expect(
      parsePostTheoreticalConsumptionBody({
        locationId: LOC,
        occurredOn: "2026-08-01",
        storageAreaId: AREA,
        allowNegativeOverride: "yes",
      }).ok,
    ).toBe(false);
  });
});

describe("parseReverseSalesLineBody", () => {
  it("trims a supplied reason", () => {
    expect(parseReverseSalesLineBody({ reasonCode: " wrong entry " })).toEqual({
      ok: true,
      reasonCode: "wrong entry",
    });
  });

  it("rejects an absent body, a blank reason and a non-string reason", () => {
    expect(parseReverseSalesLineBody(undefined)).toEqual({ ok: false });
    expect(parseReverseSalesLineBody({ reasonCode: "   " })).toEqual({ ok: false });
    expect(parseReverseSalesLineBody({ reasonCode: 42 })).toEqual({ ok: false });
  });
});

describe("toSalesTransactionRows", () => {
  it("resolves location/channel labels and the line count", () => {
    const rows = toSalesTransactionRows(ORG, [transaction()], REFS, new Map([["txn-1", 3]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "txn-1",
      locationCode: "DEMO_CAFE",
      locationName: "Demo Café Oslo",
      channelCode: "WOLT",
      channelName: "Wolt",
      lineCount: 3,
      grossAmount: "377.0000",
      refundAmount: null,
    });
  });

  it("drops a foreign-organization row and leaves unknown refs null", () => {
    const rows = toSalesTransactionRows(
      ORG,
      [
        transaction({ id: "txn-foreign", organizationId: OTHER }),
        transaction({ id: "txn-2", locationId: null, channelId: null }),
      ],
      REFS,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "txn-2",
      locationCode: null,
      channelCode: null,
      lineCount: 0,
    });
  });
});

describe("toSalesLineRows", () => {
  it("maps the row-12 line fields and drops foreign lines", () => {
    const rows = toSalesLineRows(ORG, [
      line(),
      line({ id: "line-foreign", organizationId: OTHER }),
      line({ id: "line-2", optionKind: "included", parentLineId: "line-1" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["line-1", "line-2"]);
    expect(rows[0]).toMatchObject({
      sku: "DEMO-SKU-ESPRESSO",
      appliedTaxRate: "0.250000",
      optionKind: "standalone",
      mappingState: "mapped",
      reversalOfId: null,
    });
    expect(rows[1]).toMatchObject({ optionKind: "included", parentLineId: "line-1" });
  });
});
