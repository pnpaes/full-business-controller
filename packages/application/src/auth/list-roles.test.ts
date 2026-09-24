import { describe, expect, it } from "vitest";

import { listRoles } from "./list-roles";
import { FakeAuthStore, ORG } from "./test-support";

describe("listRoles", () => {
  it("returns only the organization's roles, ordered by code", async () => {
    const store = new FakeAuthStore();
    store.addRole("role-b", "baker", "Baker");
    store.addRole("role-a", "admin", "Admin");
    store.addRole("role-x", "owner", "Owner", "org-2");

    const rows = await listRoles(store, { organizationId: ORG });

    expect(rows.map((row) => row.code)).toEqual(["admin", "baker"]);
    expect(rows[0]).toEqual({ id: "role-a", code: "admin", name: "Admin", description: null });
  });

  it("returns an empty catalogue for an organization with no roles", async () => {
    const store = new FakeAuthStore();
    expect(await listRoles(store, { organizationId: ORG })).toEqual([]);
  });
});
