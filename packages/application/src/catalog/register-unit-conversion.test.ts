import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { registerUnit } from "./register-unit";
import { registerUnitConversion } from "./register-unit-conversion";
import { FakeMasterDataStore } from "./test-support";

const ORG = "org-1";
const ACTOR = "user-1";

async function seedUnits(store: FakeMasterDataStore): Promise<void> {
  await registerUnit(store, { organizationId: ORG, code: "kg", dimension: "mass" });
  await registerUnit(store, { organizationId: ORG, code: "g", dimension: "mass", isBase: true });
}

describe("registerUnitConversion", () => {
  it("registers a global conversion and audits it", async () => {
    const store = new FakeMasterDataStore();
    await seedUnits(store);

    const result = await registerUnitConversion(store, {
      organizationId: ORG,
      actorId: ACTOR,
      fromUnitCode: "kg",
      toUnitCode: "g",
      factor: "1000",
    });

    expect(result.conversionId).toBeTruthy();
    expect(store.conversions).toHaveLength(1);
    expect(store.conversions[0]).toMatchObject({ factor: "1000", itemId: null });
    expect(store.audits[0]).toMatchObject({
      action: "catalog.unit_conversion.registered",
      entityType: "unit_conversion",
      entityId: result.conversionId,
    });
  });

  it("rejects a duplicate pair for the same scope", async () => {
    const store = new FakeMasterDataStore();
    await seedUnits(store);
    await registerUnitConversion(store, {
      organizationId: ORG,
      actorId: ACTOR,
      fromUnitCode: "kg",
      toUnitCode: "g",
      factor: "1000",
    });

    await expect(
      registerUnitConversion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        fromUnitCode: "kg",
        toUnitCode: "g",
        factor: "1000",
      }),
    ).rejects.toThrow("a conversion for this unit pair is already effective");
    expect(store.conversions).toHaveLength(1);
  });

  it("rejects identical, unknown and non-positive-factor inputs", async () => {
    const store = new FakeMasterDataStore();
    await seedUnits(store);

    await expect(
      registerUnitConversion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        fromUnitCode: "kg",
        toUnitCode: "kg",
        factor: "1",
      }),
    ).rejects.toThrow("from and to units must differ");

    await expect(
      registerUnitConversion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        fromUnitCode: "kg",
        toUnitCode: "stone",
        factor: "1",
      }),
    ).rejects.toThrow('unit "stone" not found');

    await expect(
      registerUnitConversion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        fromUnitCode: "kg",
        toUnitCode: "g",
        factor: "0",
      }),
    ).rejects.toThrow(DomainError);

    await expect(
      registerUnitConversion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        fromUnitCode: "kg",
        toUnitCode: "g",
        factor: "1e3",
      }),
    ).rejects.toThrow(DomainError);
    expect(store.conversions).toHaveLength(0);
  });

  it("rejects a non-positive effective window", async () => {
    const store = new FakeMasterDataStore();
    await seedUnits(store);
    const from = new Date("2026-02-01T00:00:00.000Z");
    await expect(
      registerUnitConversion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        fromUnitCode: "kg",
        toUnitCode: "g",
        factor: "1000",
        effectiveFrom: from,
        effectiveTo: from,
      }),
    ).rejects.toThrow("effectiveTo must be after effectiveFrom");
  });
});
