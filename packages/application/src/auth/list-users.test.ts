import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { DEFAULT_USER_LIMIT, MAX_USER_LIMIT, listUsers } from "./list-users";
import { FakeAuthStore, ORG } from "./test-support";

describe("listUsers", () => {
  it("returns the organization's users ordered by display name, with roles and scopes", async () => {
    const store = new FakeAuthStore();
    const ada = store.addUser({ id: "u-1", displayName: "Ada" });
    store.addUser({ id: "u-2", displayName: "Bo" });
    store.addUser({ id: "u-3", displayName: "Zed", organizationId: "org-2" });
    store.addRole("role-owner", "owner");
    await store.assignRole({
      userId: ada.id,
      roleId: "role-owner",
      locationId: null,
      grantedBy: null,
    });
    await store.replaceLocationScopes(ada.id, ["loc-1"]);

    const rows = await listUsers(store, { organizationId: ORG });

    expect(rows.map((row) => row.displayName)).toEqual(["Ada", "Bo"]);
    expect(rows[0]?.roles).toEqual([{ roleId: "role-owner", code: "owner", locationId: null }]);
    expect(rows[0]?.locationIds).toEqual(["loc-1"]);
  });

  it("applies the default limit and the offset", async () => {
    const store = new FakeAuthStore();
    store.addUser({ id: "u-1", displayName: "A" });
    store.addUser({ id: "u-2", displayName: "B" });
    expect(DEFAULT_USER_LIMIT).toBe(50);

    const page = await listUsers(store, { organizationId: ORG, limit: 1, offset: 1 });

    expect(page.map((row) => row.id)).toEqual(["u-2"]);
  });

  it("never returns credential material", async () => {
    const store = new FakeAuthStore();
    store.addUser({ id: "u-1" });

    const [row] = await listUsers(store, { organizationId: ORG });

    expect(row).not.toHaveProperty("passwordHash");
    expect(row).not.toHaveProperty("secretEncrypted");
    expect(row).not.toHaveProperty("recoveryCodesHash");
  });

  it("rejects an out-of-range limit and a negative offset", async () => {
    const store = new FakeAuthStore();
    await expect(listUsers(store, { organizationId: ORG, limit: 0 })).rejects.toThrow(DomainError);
    await expect(
      listUsers(store, { organizationId: ORG, limit: MAX_USER_LIMIT + 1 }),
    ).rejects.toThrow(DomainError);
    await expect(listUsers(store, { organizationId: ORG, offset: -1 })).rejects.toThrow(
      DomainError,
    );
  });
});
