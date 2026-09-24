import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUDIT_EVENT_LIMIT,
  MAX_AUDIT_EVENT_LIMIT,
  listAuditEvents,
} from "./list-audit-events";
import { FakeAuthStore, ORG } from "./test-support";
import type { AuditEventRecord } from "./types";

function event(overrides: Partial<AuditEventRecord> & { readonly id: string }): AuditEventRecord {
  return {
    organizationId: ORG,
    actorId: null,
    impersonationContext: null,
    action: "login_success",
    entityType: "app_user",
    entityId: null,
    entityVersion: null,
    before: null,
    after: null,
    reason: null,
    requestId: null,
    correlationId: null,
    occurredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildStore(): FakeAuthStore {
  const store = new FakeAuthStore();
  store.addAuditEvent(event({ id: "a", action: "login_success" }));
  store.addAuditEvent(
    event({
      id: "b",
      action: "role_granted",
      entityType: "app_user",
      occurredAt: "2026-01-03T00:00:00.000Z",
    }),
  );
  store.addAuditEvent(event({ id: "other-org", organizationId: "org-2" }));
  return store;
}

describe("listAuditEvents", () => {
  it("returns only the organization's events, newest first", async () => {
    const rows = await listAuditEvents(buildStore(), { organizationId: ORG });
    expect(rows.map((row) => row.id)).toEqual(["b", "a"]);
    expect(DEFAULT_AUDIT_EVENT_LIMIT).toBe(50);
  });

  it("passes the action and entity-type filters through", async () => {
    const store = buildStore();
    expect(
      (await listAuditEvents(store, { organizationId: ORG, action: "role_granted" })).map(
        (row) => row.id,
      ),
    ).toEqual(["b"]);
    expect(
      (await listAuditEvents(store, { organizationId: ORG, entityType: "app_user" })).map(
        (row) => row.id,
      ),
    ).toEqual(["b", "a"]);
    expect(
      (await listAuditEvents(store, { organizationId: ORG, entityType: "item" })).map(
        (row) => row.id,
      ),
    ).toEqual([]);
  });

  it("applies limit and offset", async () => {
    const rows = await listAuditEvents(buildStore(), { organizationId: ORG, limit: 1, offset: 1 });
    expect(rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("rejects an out-of-range limit and a negative offset", async () => {
    const store = buildStore();
    await expect(listAuditEvents(store, { organizationId: ORG, limit: 0 })).rejects.toThrow(
      DomainError,
    );
    await expect(
      listAuditEvents(store, { organizationId: ORG, limit: MAX_AUDIT_EVENT_LIMIT + 1 }),
    ).rejects.toThrow(DomainError);
    await expect(listAuditEvents(store, { organizationId: ORG, offset: -1 })).rejects.toThrow(
      DomainError,
    );
  });
});
