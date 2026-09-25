import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { registerIntegrationSource } from "./register-integration-source";
import { FakeIntegrationSourceStore } from "./test-support";

const ORG = "org-1";
const ACTOR = "user-1";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    actorId: ACTOR,
    name: "Frontline POS",
    systemType: "pos",
    credentialsOwner: "TECH",
    ...overrides,
  };
}

describe("registerIntegrationSource", () => {
  it("registers a read-only source with the read-only defaults and audits it", async () => {
    const store = new FakeIntegrationSourceStore();

    const result = await registerIntegrationSource(store, baseInput());

    expect(store.sources).toEqual([
      expect.objectContaining({
        id: result.integrationSourceId,
        organizationId: ORG,
        name: "Frontline POS",
        systemType: "pos",
        direction: "read",
        allowedOperations: [],
        credentialsOwner: "TECH",
        rateLimitNote: null,
        termsStatus: "pending",
        active: true,
      }),
    ]);
    expect(store.audits.at(-1)).toMatchObject({
      action: "integrations.integration_source.created",
      entityType: "integration_source",
      entityId: result.integrationSourceId,
    });
  });

  it("trims the name and credentials owner", async () => {
    const store = new FakeIntegrationSourceStore();
    await registerIntegrationSource(
      store,
      baseInput({ name: "  Wolt  ", credentialsOwner: "  TECH " }),
    );
    expect(store.sources[0]).toMatchObject({ name: "Wolt", credentialsOwner: "TECH" });
  });

  it("rejects a duplicate name for the organization", async () => {
    const store = new FakeIntegrationSourceStore();
    await registerIntegrationSource(store, baseInput());

    await expect(registerIntegrationSource(store, baseInput())).rejects.toThrow(
      /name "Frontline POS" already exists/,
    );
  });

  it("allows the same name in a different organization", async () => {
    const store = new FakeIntegrationSourceStore();
    await registerIntegrationSource(store, baseInput());
    await expect(
      registerIntegrationSource(store, baseInput({ organizationId: "org-2" })),
    ).resolves.toBeDefined();
  });

  it("rejects empty name or credentials owner", async () => {
    const store = new FakeIntegrationSourceStore();
    await expect(registerIntegrationSource(store, baseInput({ name: "   " }))).rejects.toThrow(
      /name must not be empty/,
    );
    await expect(
      registerIntegrationSource(store, baseInput({ credentialsOwner: "  " })),
    ).rejects.toThrow(/credentialsOwner must not be empty/);
  });

  it("rejects an out-of-vocabulary system type, direction or terms status", async () => {
    const store = new FakeIntegrationSourceStore();
    await expect(
      registerIntegrationSource(store, baseInput({ systemType: "shopify" })),
    ).rejects.toThrow(/systemType must be one of/);
    await expect(
      registerIntegrationSource(store, baseInput({ direction: "sync" })),
    ).rejects.toThrow(/direction must be one of/);
    await expect(
      registerIntegrationSource(store, baseInput({ termsStatus: "granted" })),
    ).rejects.toThrow(/termsStatus must be one of/);
  });

  it("rejects an operation outside ALLOWED_OPERATION", async () => {
    const store = new FakeIntegrationSourceStore();
    await expect(
      registerIntegrationSource(store, baseInput({ allowedOperations: ["read", "write_menu"] })),
    ).rejects.toThrow(/allowedOperations must only contain/);
  });

  it("refuses a write operation while terms are pending (DEC-015)", async () => {
    const store = new FakeIntegrationSourceStore();
    await expect(
      registerIntegrationSource(
        store,
        baseInput({ allowedOperations: ["read", "write_stock"], termsStatus: "pending" }),
      ),
    ).rejects.toThrow(/write operation only when termsStatus is "approved"/);
    expect(store.sources).toHaveLength(0);
  });

  it("accepts a write operation once terms are approved", async () => {
    const store = new FakeIntegrationSourceStore();
    const result = await registerIntegrationSource(
      store,
      baseInput({
        allowedOperations: ["read", "write_accounting"],
        termsStatus: "approved",
      }),
    );
    expect(store.sources[0]).toMatchObject({
      id: result.integrationSourceId,
      allowedOperations: ["read", "write_accounting"],
      termsStatus: "approved",
    });
  });

  it("fails with DomainError for an out-of-vocabulary value", async () => {
    const store = new FakeIntegrationSourceStore();
    await expect(
      registerIntegrationSource(store, baseInput({ systemType: "nope" })),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
