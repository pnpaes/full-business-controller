import { describe, expect, it } from "vitest";

import { audit } from "./audit";
import { FakeAuthStore, ORG } from "./test-support";

const base = {
  organizationId: ORG,
  actorId: null,
  action: "test.action",
  entityId: null,
} as const;

describe("audit diff guard", () => {
  it("rejects a diff that carries a credential, hash or token", async () => {
    const store = new FakeAuthStore();

    await expect(audit(store, { ...base, after: { passwordHash: "hash" } })).rejects.toThrow(
      'must not contain "passwordHash"',
    );
    expect(store.audits).toHaveLength(0);
  });

  it("rejects a forbidden key nested anywhere in the diff", async () => {
    const store = new FakeAuthStore();

    await expect(
      audit(store, { ...base, before: { user: { outer: [{ tokenHash: "x" }] } } }),
    ).rejects.toThrow('must not contain "tokenHash"');
    expect(store.audits).toHaveLength(0);
  });

  it("accepts a clean diff and writes it", async () => {
    const store = new FakeAuthStore();

    await audit(store, {
      ...base,
      after: { roles: [{ code: "owner", locationId: "loc-1" }], revokedSessions: 2 },
    });

    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]?.action).toBe("test.action");
  });
});
