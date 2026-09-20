import type { InventoryLocationRecord, InventoryStorageAreaRecord } from "@aquarela/application";
import { describe, expect, it } from "vitest";

import {
  parseRegisterStorageAreaBody,
  parseStorageAreaQuery,
  toStorageAreaRows,
} from "./storage-area-rows";

const ORG = "1448a476-32f2-426f-b153-11a851011e48";
const OTHER_ORG = "00000000-0000-4000-8000-000000000000";
const LOCATION = "9fe2b5a0-c643-459f-85c3-f3c64f3932ce";
const AREA = "943c94b6-83de-4688-80c6-4dbd9e13520a";

function area(overrides: Partial<InventoryStorageAreaRecord> = {}): InventoryStorageAreaRecord {
  return {
    id: AREA,
    organizationId: ORG,
    locationId: LOCATION,
    code: "DRY",
    name: "Dry store",
    kind: "dry_store",
    isTransit: false,
    ...overrides,
  };
}

function locations(
  overrides: Partial<InventoryLocationRecord> = {},
): ReadonlyMap<string, InventoryLocationRecord> {
  return new Map([
    [
      LOCATION,
      {
        id: LOCATION,
        organizationId: ORG,
        code: "OSLO",
        name: "Oslo",
        kind: "operating",
        ...overrides,
      },
    ],
  ]);
}

describe("parseStorageAreaQuery", () => {
  it("accepts an absent or valid location filter and rejects a malformed one", () => {
    expect(parseStorageAreaQuery(new URLSearchParams())).toEqual({ ok: true });
    expect(parseStorageAreaQuery(new URLSearchParams({ locationId: LOCATION }))).toEqual({
      ok: true,
      locationId: LOCATION,
    });
    expect(parseStorageAreaQuery(new URLSearchParams({ locationId: "nope" }))).toEqual({
      ok: false,
    });
  });
});

describe("parseRegisterStorageAreaBody", () => {
  const base = { locationId: LOCATION, code: "FREEZER", name: "Walk-in freezer", kind: "freezer" };

  it("maps a valid body and defaults isTransit", () => {
    expect(parseRegisterStorageAreaBody(base)).toEqual({
      ok: true,
      input: { ...base, isTransit: false },
    });
    expect(parseRegisterStorageAreaBody({ ...base, isTransit: true })).toMatchObject({
      ok: true,
      input: { isTransit: true },
    });
  });

  it("rejects a bad location, blank text, unknown kind and non-boolean transit", () => {
    expect(parseRegisterStorageAreaBody({ ...base, locationId: "nope" }).ok).toBe(false);
    expect(parseRegisterStorageAreaBody({ ...base, code: "  " }).ok).toBe(false);
    expect(parseRegisterStorageAreaBody({ ...base, name: "" }).ok).toBe(false);
    expect(parseRegisterStorageAreaBody({ ...base, kind: "walkin" }).ok).toBe(false);
    expect(parseRegisterStorageAreaBody({ ...base, isTransit: "yes" }).ok).toBe(false);
    expect(parseRegisterStorageAreaBody(undefined).ok).toBe(false);
  });
});

describe("toStorageAreaRows", () => {
  it("resolves the location code and org-checks the reference", () => {
    const [row] = toStorageAreaRows(ORG, [area()], locations());
    expect(row).toEqual({
      id: AREA,
      locationId: LOCATION,
      locationCode: "OSLO",
      code: "DRY",
      name: "Dry store",
      kind: "dry_store",
      isTransit: false,
    });
    const [foreignRef] = toStorageAreaRows(
      ORG,
      [area()],
      locations({ organizationId: OTHER_ORG, code: "LEAKED" }),
    );
    expect(foreignRef?.locationCode).toBeNull();
  });

  it("drops another organization's areas", () => {
    expect(toStorageAreaRows(ORG, [area({ organizationId: OTHER_ORG })], locations())).toEqual([]);
  });
});
