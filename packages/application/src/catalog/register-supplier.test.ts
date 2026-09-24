import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { registerSupplier } from "./register-supplier";
import { FakeMasterDataStore } from "./test-support";

const ORG = "org-1";
const ACTOR = "user-1";

describe("registerSupplier", () => {
  it("creates a supplier with the organization currency and audits it", async () => {
    const store = new FakeMasterDataStore();
    store.organizations.set(ORG, "EUR");

    const result = await registerSupplier(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "  SUP-1  ",
      name: "  Nordkaffe  ",
    });

    expect(result.created).toBe(true);
    expect(store.supplierMasters).toHaveLength(1);
    expect(store.supplierMasters[0]).toMatchObject({
      code: "SUP-1",
      name: "Nordkaffe",
      currency: "EUR",
      active: true,
    });
    expect(store.audits[0]).toMatchObject({
      action: "catalog.supplier.registered",
      entityType: "supplier",
      entityId: result.supplierId,
    });
  });

  it("is idempotent on the natural key (organization, code)", async () => {
    const store = new FakeMasterDataStore();
    const first = await registerSupplier(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "SUP-1",
      name: "Nordkaffe",
    });
    const second = await registerSupplier(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "SUP-1",
      name: "A different name",
    });

    expect(second.created).toBe(false);
    expect(second.supplierId).toBe(first.supplierId);
    expect(store.supplierMasters).toHaveLength(1);
    expect(store.audits).toHaveLength(1);
  });

  it("honours an explicit currency and rejects a malformed one", async () => {
    const store = new FakeMasterDataStore();
    const result = await registerSupplier(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "SUP-1",
      name: "Nordkaffe",
      currency: "usd",
    });
    expect(store.supplierMasters[0]?.currency).toBe("USD");

    await expect(
      registerSupplier(store, {
        organizationId: ORG,
        actorId: ACTOR,
        code: "SUP-2",
        name: "Bad",
        currency: "us",
      }),
    ).rejects.toThrow("currency must be a 3-letter ISO code");
    expect(result.created).toBe(true);
  });

  it("rejects an empty code or name", async () => {
    const store = new FakeMasterDataStore();
    await expect(
      registerSupplier(store, { organizationId: ORG, actorId: ACTOR, code: "  ", name: "x" }),
    ).rejects.toThrow("supplier code must not be empty");
    await expect(
      registerSupplier(store, { organizationId: ORG, actorId: ACTOR, code: "SUP-1", name: " " }),
    ).rejects.toThrow(DomainError);
  });
});
