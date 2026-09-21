import { describe, expect, it } from "vitest";

import { getPriceVersion, listPriceVersions } from "./price-version";
import type { NewPriceVersionRecord, PriceVersionRecord } from "./price-scenario-types";
import { FakePriceScenarioStore } from "./price-scenario-test-support";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const VARIANT = "variant-1";

function seedVersion(
  store: FakePriceScenarioStore,
  overrides: Partial<NewPriceVersionRecord> = {},
): Promise<PriceVersionRecord> {
  return store.createPriceVersion({
    organizationId: ORG,
    productVariantId: VARIANT,
    locationId: null,
    channelId: null,
    grossPrice: "39.0000",
    netPrice: "33.9130",
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    approvedBy: "user-1",
    approvedAt: "2026-01-01T00:00:00Z",
    sourceScenarioId: "scenario-1",
    ...overrides,
  });
}

describe("listPriceVersions", () => {
  it("returns the organization's versions, newest effectiveFrom first", async () => {
    const store = new FakePriceScenarioStore();
    await seedVersion(store, {
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: "2026-02-01T00:00:00Z",
    });
    const latest = await seedVersion(store, { effectiveFrom: "2026-02-01T00:00:00Z" });

    const { versions } = await listPriceVersions(store, { organizationId: ORG });

    expect(versions.map((version) => version.id)).toEqual([latest.id, expect.any(String)]);
    expect(versions.map((version) => version.effectiveFrom)).toEqual([
      "2026-02-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    ]);
  });

  it("does not expose a foreign organization's versions", async () => {
    const store = new FakePriceScenarioStore();
    await seedVersion(store);
    await seedVersion(store, { organizationId: OTHER_ORG, sourceScenarioId: "scenario-2" });

    const { versions } = await listPriceVersions(store, { organizationId: ORG });

    expect(versions).toHaveLength(1);
    expect(versions.every((version) => version.organizationId === ORG)).toBe(true);
    expect(await listPriceVersions(store, { organizationId: OTHER_ORG })).toEqual({
      versions: [expect.objectContaining({ organizationId: OTHER_ORG })],
    });
  });
});

describe("getPriceVersion", () => {
  it("returns one version by id", async () => {
    const store = new FakePriceScenarioStore();
    const created = await seedVersion(store);

    const found = await getPriceVersion(store, {
      organizationId: ORG,
      priceVersionId: created.id,
    });

    expect(found).toEqual(created);
  });

  it("reads a foreign-org or unknown id as undefined", async () => {
    const store = new FakePriceScenarioStore();
    const foreign = await seedVersion(store, { organizationId: OTHER_ORG });

    expect(
      await getPriceVersion(store, { organizationId: ORG, priceVersionId: foreign.id }),
    ).toBeUndefined();
    expect(
      await getPriceVersion(store, { organizationId: ORG, priceVersionId: "missing" }),
    ).toBeUndefined();
  });
});

describe("effective price lookup", () => {
  function asOf(
    store: FakePriceScenarioStore,
    iso: string,
  ): Promise<PriceVersionRecord | undefined> {
    return store.findEffectivePriceVersion({
      organizationId: ORG,
      productVariantId: VARIANT,
      locationId: null,
      channelId: null,
      asOf: new Date(iso),
    });
  }

  it("treats the window as half-open [effectiveFrom, effectiveTo)", async () => {
    const store = new FakePriceScenarioStore();
    const version = await seedVersion(store, {
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: "2026-02-01T00:00:00Z",
    });

    expect((await asOf(store, "2026-01-01T00:00:00Z"))?.id).toBe(version.id);
    expect((await asOf(store, "2026-01-31T23:59:59Z"))?.id).toBe(version.id);
    expect(await asOf(store, "2026-02-01T00:00:00Z")).toBeUndefined();
    expect(await asOf(store, "2025-12-31T23:59:59Z")).toBeUndefined();
  });

  it("resolves an open-ended version at any later instant", async () => {
    const store = new FakePriceScenarioStore();
    const version = await seedVersion(store, { effectiveTo: null });

    expect((await asOf(store, "2030-06-01T00:00:00Z"))?.id).toBe(version.id);
  });
});
