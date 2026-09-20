import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryUnitRecord,
  ProductionBatchInputRecord,
  ProductionBatchOutputRecord,
  ProductionBatchRecord,
  ProductionPlanRecord,
  ProductionRecipeRecord,
  ProductionRecipeVersionRecord,
  StockLotRecord,
} from "@aquarela/application";
import { describe, expect, it } from "vitest";

import {
  parseCancelProductionBatchBody,
  parseCompleteProductionBatchBody,
  parseCreateProductionBatchBody,
  parseCreateProductionPlanBody,
  parseProductionBatchListQuery,
  parseProductionPlanListQuery,
  parseStartProductionBatchBody,
  toProductionBatchInputRows,
  toProductionBatchOutputRows,
  toProductionBatchRows,
  toProductionPlanRows,
  type ProductionRefs,
} from "./production-rows";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const OUTPUT_ITEM = "22222222-2222-4222-8222-22222222220f";
const UNIT = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const RECIPE = "66666666-6666-4666-8666-666666666666";
const PLAN = "77777777-7777-4777-8777-777777777777";
const BATCH = "88888888-8888-4888-8888-888888888888";
const AREA = "99999999-9999-4999-8999-999999999999";
const LOT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function planRecord(overrides: Partial<ProductionPlanRecord> = {}): ProductionPlanRecord {
  return {
    id: PLAN,
    organizationId: ORG,
    locationId: LOCATION,
    productionDate: "2026-09-20",
    status: "planned",
    createdAt: "2026-09-19T10:00:00.000Z",
    createdBy: "actor-1",
    ...overrides,
  };
}

function batchRecord(overrides: Partial<ProductionBatchRecord> = {}): ProductionBatchRecord {
  return {
    id: BATCH,
    organizationId: ORG,
    locationId: LOCATION,
    workstation: "bar",
    recipeVersionId: VERSION,
    planId: PLAN,
    status: "completed",
    plannedStart: "2026-09-20T08:00:00.000Z",
    actualStart: "2026-09-20T08:05:00.000Z",
    actualFinish: "2026-09-20T08:30:00.000Z",
    operatorId: null,
    destinationStorageAreaId: AREA,
    plannedOutputQty: "1.000000",
    actualOutputQty: "1.000000",
    yieldVariancePct: "0.000000",
    reversalOfId: null,
    createdAt: "2026-09-19T10:00:00.000Z",
    ...overrides,
  };
}

function inputRecord(
  overrides: Partial<ProductionBatchInputRecord> = {},
): ProductionBatchInputRecord {
  return {
    id: "input-1",
    productionBatchId: BATCH,
    itemId: ITEM,
    unitId: UNIT,
    plannedQty: "18.000000",
    actualQty: "17.500000",
    varianceQty: "-0.500000",
    lotId: LOT,
    reasonCode: "over-pour",
    movementId: "movement-1",
    ...overrides,
  };
}

function outputRecord(
  overrides: Partial<ProductionBatchOutputRecord> = {},
): ProductionBatchOutputRecord {
  return {
    id: "output-1",
    productionBatchId: BATCH,
    itemId: OUTPUT_ITEM,
    unitId: UNIT,
    kind: "finished",
    plannedQty: "1.000000",
    actualQty: "1.000000",
    varianceQty: "0.000000",
    lotId: null,
    expiryDate: "2026-09-27",
    movementId: "movement-2",
    ...overrides,
  };
}

function refs(overrides: Partial<ProductionRefs> = {}): ProductionRefs {
  const version: ProductionRecipeVersionRecord = {
    id: VERSION,
    recipeId: RECIPE,
    versionNo: 1,
    state: "approved",
    plannedInputQty: "20.000000",
    plannedOutputQty: "1.000000",
    approvedUsableOutput: "0.900000",
    yieldRate: "0.900000",
    effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
    effectiveTo: null,
  };
  const recipe: ProductionRecipeRecord = {
    id: RECIPE,
    organizationId: ORG,
    code: "DEMO_HOUSE_BLEND",
    name: "Demo House Blend",
    outputItemId: OUTPUT_ITEM,
  };
  const item: InventoryItemRecord = {
    id: ITEM,
    organizationId: ORG,
    code: "DEMO_ESPRESSO_BEANS",
    name: "Demo Espresso Beans",
    baseUnitId: UNIT,
    inventoryPolicy: "stocked",
    lotTracked: true,
  };
  const outputItem: InventoryItemRecord = {
    id: OUTPUT_ITEM,
    organizationId: ORG,
    code: "DEMO_HOUSE_BLEND",
    name: "Demo House Blend",
    baseUnitId: UNIT,
    inventoryPolicy: "stocked",
    lotTracked: true,
  };
  const unit: InventoryUnitRecord = {
    id: UNIT,
    organizationId: ORG,
    code: "g",
    dimension: "mass",
  };
  const location: InventoryLocationRecord = {
    id: LOCATION,
    organizationId: ORG,
    code: "DEMO_CAFE",
    name: "Demo Café Oslo",
    kind: "operating",
  };
  const lot: StockLotRecord = {
    id: LOT,
    organizationId: ORG,
    itemId: ITEM,
    locationId: LOCATION,
    lotNumber: "LOT-1",
    expiryDate: null,
    openedDate: null,
    receivedAt: null,
    sourceMovementId: null,
  };
  return {
    locations: new Map([[LOCATION, location]]),
    recipeVersions: new Map([[VERSION, version]]),
    recipes: new Map([[RECIPE, recipe]]),
    items: new Map([
      [ITEM, item],
      [OUTPUT_ITEM, outputItem],
    ]),
    units: new Map([[UNIT, unit]]),
    lots: new Map([[LOT, lot]]),
    ...overrides,
  };
}

describe("parseProductionPlanListQuery", () => {
  it("defaults paging and accepts a location and free-text status", () => {
    expect(parseProductionPlanListQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { limit: 50, offset: 0 },
    });
    expect(
      parseProductionPlanListQuery(new URLSearchParams({ locationId: LOCATION, status: "draft" })),
    ).toEqual({
      ok: true,
      query: { locationId: LOCATION, status: "draft", limit: 50, offset: 0 },
    });
  });

  it("rejects a malformed uuid and out-of-range paging", () => {
    expect(parseProductionPlanListQuery(new URLSearchParams({ locationId: "nope" })).ok).toBe(
      false,
    );
    expect(parseProductionPlanListQuery(new URLSearchParams({ limit: "0" })).ok).toBe(false);
    expect(parseProductionPlanListQuery(new URLSearchParams({ offset: "-1" })).ok).toBe(false);
  });
});

describe("parseProductionBatchListQuery", () => {
  it("accepts a vocabulary status and the plan/workstation filters", () => {
    const parsed = parseProductionBatchListQuery(
      new URLSearchParams({
        locationId: LOCATION,
        planId: PLAN,
        status: "in_progress",
        workstation: "bar",
        limit: "10",
        offset: "5",
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      query: {
        locationId: LOCATION,
        planId: PLAN,
        status: "in_progress",
        workstation: "bar",
        limit: 10,
        offset: 5,
      },
    });
  });

  it("rejects an unknown batch status, a bad uuid and an out-of-range limit", () => {
    expect(parseProductionBatchListQuery(new URLSearchParams({ status: "paused" })).ok).toBe(false);
    expect(parseProductionBatchListQuery(new URLSearchParams({ planId: "nope" })).ok).toBe(false);
    expect(parseProductionBatchListQuery(new URLSearchParams({ limit: "201" })).ok).toBe(false);
  });
});

describe("parseCreateProductionPlanBody", () => {
  it("defaults the optional status and deterministic id to null", () => {
    expect(
      parseCreateProductionPlanBody({ locationId: LOCATION, productionDate: "2026-09-20" }),
    ).toEqual({
      ok: true,
      input: {
        locationId: LOCATION,
        productionDate: "2026-09-20",
        status: null,
        productionPlanId: null,
      },
    });
  });

  it("rejects a bad location and a non-date production date", () => {
    expect(
      parseCreateProductionPlanBody({ locationId: "x", productionDate: "2026-09-20" }).ok,
    ).toBe(false);
    expect(
      parseCreateProductionPlanBody({ locationId: LOCATION, productionDate: "2026-09" }).ok,
    ).toBe(false);
    expect(parseCreateProductionPlanBody(undefined).ok).toBe(false);
  });
});

describe("parseCreateProductionBatchBody", () => {
  it("accepts the required ids and optional plan/area/start", () => {
    const parsed = parseCreateProductionBatchBody({
      locationId: LOCATION,
      recipeVersionId: VERSION,
      planId: PLAN,
      destinationStorageAreaId: AREA,
      plannedStart: "2026-09-20T08:00:00.000Z",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input).toMatchObject({
        locationId: LOCATION,
        recipeVersionId: VERSION,
        planId: PLAN,
        destinationStorageAreaId: AREA,
        plannedStart: "2026-09-20T08:00:00.000Z",
        workstation: null,
        operatorId: null,
        productionBatchId: null,
      });
    }
  });

  it("rejects a missing recipe version and a malformed planned start", () => {
    expect(parseCreateProductionBatchBody({ locationId: LOCATION }).ok).toBe(false);
    expect(
      parseCreateProductionBatchBody({
        locationId: LOCATION,
        recipeVersionId: VERSION,
        plannedStart: "2026-09-20",
      }).ok,
    ).toBe(false);
  });
});

describe("parseCompleteProductionBatchBody", () => {
  const valid = {
    actualFinish: "2026-09-20T08:30:00.000Z",
    inputStorageAreaId: AREA,
    inputs: [{ itemId: ITEM, actualQty: "17.500000", reasonCode: "over-pour" }],
    output: { itemId: OUTPUT_ITEM, actualQty: "1.000000", expiryDate: "2026-09-27" },
  };

  it("accepts actuals, the draw area and the output", () => {
    const parsed = parseCompleteProductionBatchBody(valid);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input.inputStorageAreaId).toBe(AREA);
      expect(parsed.input.inputs).toHaveLength(1);
      expect(parsed.input.inputs[0]).toMatchObject({ lotId: null, reasonCode: "over-pour" });
      expect(parsed.input.output).toMatchObject({ itemId: OUTPUT_ITEM, expiryDate: "2026-09-27" });
      expect(parsed.input.allowNegativeOverride).toBe(false);
      expect(parsed.input.idempotencyKey).toBeNull();
    }
  });

  it("rejects a non-positive output, a negative input and a malformed finish", () => {
    expect(
      parseCompleteProductionBatchBody({ ...valid, output: { ...valid.output, actualQty: "0" } })
        .ok,
    ).toBe(false);
    expect(
      parseCompleteProductionBatchBody({
        ...valid,
        inputs: [{ itemId: ITEM, actualQty: "-1" }],
      }).ok,
    ).toBe(false);
    expect(parseCompleteProductionBatchBody({ ...valid, actualFinish: "yesterday" }).ok).toBe(
      false,
    );
    expect(parseCompleteProductionBatchBody(undefined).ok).toBe(false);
  });
});

describe("parseStartProductionBatchBody", () => {
  it("treats an absent start as null and accepts an instant", () => {
    expect(parseStartProductionBatchBody(undefined)).toEqual({ ok: true, actualStart: null });
    expect(parseStartProductionBatchBody({ actualStart: "2026-09-20T08:05:00Z" })).toEqual({
      ok: true,
      actualStart: "2026-09-20T08:05:00Z",
    });
    expect(parseStartProductionBatchBody({ actualStart: "2026-09-20" }).ok).toBe(false);
  });
});

describe("parseCancelProductionBatchBody", () => {
  it("accepts an absent reason and a supplied one", () => {
    expect(parseCancelProductionBatchBody(undefined)).toEqual({ ok: true, reason: null });
    expect(parseCancelProductionBatchBody({ reason: "wrong recipe" })).toEqual({
      ok: true,
      reason: "wrong recipe",
    });
    expect(parseCancelProductionBatchBody({ reason: 4 }).ok).toBe(false);
  });
});

describe("toProductionPlanRows", () => {
  it("resolves the location and drops a foreign-organization plan", () => {
    const locations = new Map<string, InventoryLocationRecord>([
      [
        LOCATION,
        {
          id: LOCATION,
          organizationId: ORG,
          code: "DEMO_CAFE",
          name: "Demo Café Oslo",
          kind: "operating",
        },
      ],
    ]);
    const rows = toProductionPlanRows(
      ORG,
      [planRecord(), planRecord({ id: "foreign", organizationId: OTHER })],
      locations,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ locationCode: "DEMO_CAFE", status: "planned" });
  });
});

describe("toProductionBatchRows", () => {
  it("resolves the recipe, version and output item onto the batch row", () => {
    const [row] = toProductionBatchRows(ORG, [batchRecord()], refs());
    expect(row).toMatchObject({
      locationCode: "DEMO_CAFE",
      recipeCode: "DEMO_HOUSE_BLEND",
      recipeName: "Demo House Blend",
      recipeVersionNo: 1,
      outputItemCode: "DEMO_HOUSE_BLEND",
      outputUnitCode: "g",
      plannedOutputQty: "1.000000",
      yieldVariancePct: "0.000000",
    });
  });

  it("drops a foreign batch and leaves unknown references null", () => {
    const rows = toProductionBatchRows(
      ORG,
      [
        batchRecord({ organizationId: OTHER }),
        batchRecord({ id: "b2", recipeVersionId: "unknown" }),
      ],
      refs(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "b2",
      recipeCode: null,
      recipeVersionNo: null,
      outputItemId: null,
      outputItemCode: null,
    });
  });
});

describe("toProductionBatchInputRows", () => {
  it("pairs the input line with its item, unit and lot", () => {
    const rows = toProductionBatchInputRows(ORG, [inputRecord()], refs());
    expect(rows[0]).toMatchObject({
      itemCode: "DEMO_ESPRESSO_BEANS",
      unitCode: "g",
      lotNumber: "LOT-1",
      varianceQty: "-0.500000",
      reasonCode: "over-pour",
    });
  });

  it("drops a foreign item rather than echoing its label", () => {
    const foreign: InventoryItemRecord = {
      id: ITEM,
      organizationId: OTHER,
      code: "FOREIGN",
      name: "Foreign",
      baseUnitId: UNIT,
      inventoryPolicy: "stocked",
      lotTracked: false,
    };
    const rows = toProductionBatchInputRows(
      ORG,
      [inputRecord()],
      refs({ items: new Map([[ITEM, foreign]]) }),
    );
    expect(rows[0]!.itemCode).toBeNull();
    expect(rows[0]!.itemName).toBeNull();
    // The unit is its own organization-checked reference, so it still resolves.
    expect(rows[0]!.unitCode).toBe("g");
  });
});

describe("toProductionBatchOutputRows", () => {
  it("maps the output kind and expiry", () => {
    const rows = toProductionBatchOutputRows(ORG, [outputRecord()], refs());
    expect(rows[0]).toMatchObject({
      kind: "finished",
      expiryDate: "2026-09-27",
      itemCode: "DEMO_HOUSE_BLEND",
      unitCode: "g",
    });
  });
});
