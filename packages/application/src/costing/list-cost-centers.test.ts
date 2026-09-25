import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_COST_CENTER_LIMIT,
  MAX_COST_CENTER_LIMIT,
  listCostCenters,
} from "./list-cost-centers";
import { FakeCostingReadStore, seedCostingReadFixture } from "./read-test-support";
import type { CostCenterRecord } from "./types";

function center(
  overrides: Partial<CostCenterRecord> & {
    readonly id: string;
    readonly organizationId: string;
    readonly code: string;
  },
): CostCenterRecord {
  return {
    locationId: null,
    name: overrides.code,
    kind: "kitchen",
    ...overrides,
  };
}

function buildStore(): FakeCostingReadStore {
  const store = new FakeCostingReadStore();
  const { organizationId, otherOrganizationId, locationId } = seedCostingReadFixture(store);
  store.costCenters.set(
    "cc-alpha",
    center({ id: "cc-alpha", organizationId, code: "ALPHA", name: "Alpha", kind: "kitchen" }),
  );
  store.costCenters.set(
    "cc-zulu",
    center({
      id: "cc-zulu",
      organizationId,
      code: "ZULU",
      name: "Zulu",
      kind: "company_shared",
      locationId,
    }),
  );
  store.costCenters.set(
    "cc-foreign",
    center({ id: "cc-foreign", organizationId: otherOrganizationId, code: "AAA" }),
  );
  return store;
}

describe("listCostCenters", () => {
  it("returns only the organization's cost centres ordered by code", async () => {
    const store = buildStore();
    const rows = await listCostCenters(store, { organizationId: "org" });
    expect(rows.map((row) => row.id)).toEqual(["cc-alpha", "cost-center", "cc-zulu"]);
    expect(DEFAULT_COST_CENTER_LIMIT).toBe(50);
  });

  it("filters by kind and location", async () => {
    const store = buildStore();
    const shared = await listCostCenters(store, {
      organizationId: "org",
      kind: "company_shared",
    });
    expect(shared.map((row) => row.id)).toEqual(["cc-zulu"]);

    // The fixture centre and the shared one both sit at `loc`, so the location
    // filter keeps both (ordered by code) and still drops the foreign row.
    const atLocation = await listCostCenters(store, { organizationId: "org", locationId: "loc" });
    expect(atLocation.map((row) => row.id)).toEqual(["cost-center", "cc-zulu"]);
  });

  it("applies the offset over the bounded page", async () => {
    const store = buildStore();
    const rows = await listCostCenters(store, { organizationId: "org", limit: 1, offset: 1 });
    expect(rows.map((row) => row.id)).toEqual(["cost-center"]);
  });

  it("rejects an out-of-range limit and a negative offset", async () => {
    const store = buildStore();
    await expect(listCostCenters(store, { organizationId: "org", limit: 0 })).rejects.toThrow(
      DomainError,
    );
    await expect(
      listCostCenters(store, { organizationId: "org", limit: MAX_COST_CENTER_LIMIT + 1 }),
    ).rejects.toThrow(DomainError);
    await expect(listCostCenters(store, { organizationId: "org", offset: -1 })).rejects.toThrow(
      DomainError,
    );
  });
});
