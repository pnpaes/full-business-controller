import type {
  InventoryItemRecord,
  InventoryStorageAreaRecord,
  InventoryUnitRecord,
  StockCountSummary,
} from "@aquarela/application";
import { describe, expect, it } from "vitest";

import {
  parseApproveBody,
  parseCountListQuery,
  parseCountedBody,
  parseOpenCountBody,
  toCountLineRows,
  toCountRows,
  type CountRefs,
} from "./count-rows";

const ORG = "00000000-0000-4000-8000-000000000001";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const AREA = "33333333-3333-4333-8333-333333333333";
const UNIT = "44444444-4444-4444-8444-444444444444";

describe("parseCountListQuery", () => {
  it("defaults paging and accepts a location and status filter", () => {
    const parsed = parseCountListQuery(new URLSearchParams({ locationId: LOCATION, limit: "10" }));
    expect(parsed).toEqual({
      ok: true,
      query: { locationId: LOCATION, limit: 10, offset: 0 },
    });
  });

  it("rejects a malformed uuid, an unknown status and an out-of-range limit", () => {
    expect(parseCountListQuery(new URLSearchParams({ locationId: "nope" })).ok).toBe(false);
    expect(parseCountListQuery(new URLSearchParams({ status: "paused" })).ok).toBe(false);
    expect(parseCountListQuery(new URLSearchParams({ limit: "0" })).ok).toBe(false);
    expect(parseCountListQuery(new URLSearchParams({ limit: "1000" })).ok).toBe(false);
  });
});

describe("parseOpenCountBody", () => {
  it("accepts a location and instant, defaulting blind to false", () => {
    const parsed = parseOpenCountBody({
      locationId: LOCATION,
      cutoff: "2026-02-01T00:00:00.000Z",
    });
    expect(parsed).toEqual({
      ok: true,
      input: { locationId: LOCATION, cutoff: "2026-02-01T00:00:00.000Z", blind: false },
    });
  });

  it("rejects a non-uuid location, a date-only cutoff and a non-boolean blind", () => {
    expect(parseOpenCountBody({ locationId: "x", cutoff: "2026-02-01T00:00:00Z" }).ok).toBe(false);
    expect(parseOpenCountBody({ locationId: LOCATION, cutoff: "2026-02-01" }).ok).toBe(false);
    expect(
      parseOpenCountBody({
        locationId: LOCATION,
        cutoff: "2026-02-01T00:00:00Z",
        blind: "yes",
      }).ok,
    ).toBe(false);
  });
});

describe("parseCountedBody", () => {
  it("accepts observations with an optional lot and reason", () => {
    const parsed = parseCountedBody({
      lines: [
        { itemId: ITEM, storageAreaId: AREA, countedQty: "8.000000" },
        {
          itemId: ITEM,
          storageAreaId: AREA,
          lotId: "55555555-5555-4555-8555-555555555555",
          countedQty: "0",
          reasonCode: "empty",
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.lines).toHaveLength(2);
      expect(parsed.lines[0]).toMatchObject({ lotId: null, reasonCode: null });
      expect(parsed.lines[1]).toMatchObject({ reasonCode: "empty" });
    }
  });

  it("rejects an empty list, a negative quantity and a non-uuid item", () => {
    expect(parseCountedBody({ lines: [] }).ok).toBe(false);
    expect(
      parseCountedBody({ lines: [{ itemId: ITEM, storageAreaId: AREA, countedQty: "-1" }] }).ok,
    ).toBe(false);
    expect(
      parseCountedBody({ lines: [{ itemId: "x", storageAreaId: AREA, countedQty: "1" }] }).ok,
    ).toBe(false);
  });
});

describe("parseApproveBody", () => {
  it("accepts an optional unit cost and reason", () => {
    expect(parseApproveBody({})).toEqual({ ok: true, input: { unitCost: null, reasonCode: null } });
    expect(parseApproveBody({ unitCost: "5.0000", reasonCode: "recount" })).toEqual({
      ok: true,
      input: { unitCost: "5.0000", reasonCode: "recount" },
    });
  });

  it("rejects a negative or malformed unit cost", () => {
    expect(parseApproveBody({ unitCost: "-1.0000" }).ok).toBe(false);
    expect(parseApproveBody({ unitCost: "five" }).ok).toBe(false);
  });
});

describe("toCountRows", () => {
  it("maps a summary and resolves the location code, dropping foreign rows", () => {
    const summary: StockCountSummary = {
      count: {
        id: "count-1",
        organizationId: ORG,
        locationId: LOCATION,
        scope: {},
        blind: true,
        cutoff: "2026-02-01T00:00:00.000Z",
        status: "counting",
        approvedBy: null,
        approvedAt: null,
        createdAt: "2026-01-31T00:00:00.000Z",
        createdBy: "actor",
      },
      lineCount: 3,
      countedCount: 1,
      varianceCount: null,
    };
    const locations = new Map([
      [
        LOCATION,
        { id: LOCATION, organizationId: ORG, code: "MAIN", name: "Main", kind: "operating" },
      ],
    ]);
    const rows = toCountRows(ORG, [summary], locations);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ locationCode: "MAIN", blind: true, varianceCount: null });
    expect(toCountRows("other-org", [summary], locations)).toHaveLength(0);
  });
});

describe("toCountLineRows", () => {
  it("pairs each line with its item, area and base unit", () => {
    const item: InventoryItemRecord = {
      id: ITEM,
      organizationId: ORG,
      code: "FLOUR",
      name: "Flour",
      baseUnitId: UNIT,
      inventoryPolicy: "stocked",
      lotTracked: false,
    };
    const area: InventoryStorageAreaRecord = {
      id: AREA,
      organizationId: ORG,
      locationId: LOCATION,
      code: "DRY",
      name: "Dry store",
      kind: "dry_store",
      isTransit: false,
    };
    const unit: InventoryUnitRecord = {
      id: UNIT,
      organizationId: ORG,
      code: "kg",
      dimension: "mass",
    };
    const refs: CountRefs = {
      items: new Map([[ITEM, item]]),
      units: new Map([[UNIT, unit]]),
      storageAreas: new Map([[AREA, area]]),
      lots: new Map(),
    };
    const rows = toCountLineRows(
      ORG,
      [
        {
          id: "line-1",
          itemId: ITEM,
          storageAreaId: AREA,
          lotId: null,
          expectedQty: "10.000000",
          countedQty: "8.000000",
          varianceQty: "-2.000000",
          reasonCode: null,
          recount: false,
        },
      ],
      refs,
    );
    expect(rows[0]).toMatchObject({ itemCode: "FLOUR", unitCode: "kg", varianceQty: "-2.000000" });
  });
});
