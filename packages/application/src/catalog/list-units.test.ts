import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { DEFAULT_UNIT_LIMIT, MAX_UNIT_LIMIT, listUnits } from "./list-units";
import { FakeMasterDataStore } from "./test-support";

const ORG = "org-1";

function unit(id: string, code: string, dimension: "mass" | "volume" | "count" | "package") {
  return { id, code, dimension, isBase: dimension === "mass" } as const;
}

function buildStore(): FakeMasterDataStore {
  const store = new FakeMasterDataStore();
  store.addUnit(unit("u-kg", "kg", "mass"), ORG);
  store.addUnit(unit("u-g", "g", "mass"), ORG);
  store.addUnit(unit("u-l", "l", "volume"), ORG);
  store.addUnit(unit("u-other", "kg", "mass"), "org-2");
  return store;
}

describe("listUnits", () => {
  it("returns only the organization's units ordered by code", async () => {
    const store = buildStore();
    const rows = await listUnits(store, { organizationId: ORG });
    expect(rows.map((row) => row.id)).toEqual(["u-g", "u-kg", "u-l"]);
  });

  it("filters by dimension", async () => {
    const store = buildStore();
    const rows = await listUnits(store, { organizationId: ORG, dimension: "mass" });
    expect(rows.map((row) => row.id)).toEqual(["u-g", "u-kg"]);
  });

  it("applies the default limit and the offset", async () => {
    const store = buildStore();
    const first = await listUnits(store, { organizationId: ORG, limit: 1, offset: 1 });
    expect(first.map((row) => row.id)).toEqual(["u-kg"]);
    expect(DEFAULT_UNIT_LIMIT).toBe(50);
  });

  it("rejects an out-of-range limit and a negative offset", async () => {
    const store = buildStore();
    await expect(listUnits(store, { organizationId: ORG, limit: 0 })).rejects.toThrow(DomainError);
    await expect(
      listUnits(store, { organizationId: ORG, limit: MAX_UNIT_LIMIT + 1 }),
    ).rejects.toThrow(DomainError);
    await expect(listUnits(store, { organizationId: ORG, offset: -1 })).rejects.toThrow(
      DomainError,
    );
  });
});
