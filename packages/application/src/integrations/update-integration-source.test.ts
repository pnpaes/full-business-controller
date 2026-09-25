import { describe, expect, it } from "vitest";

import { registerIntegrationSource } from "./register-integration-source";
import { updateIntegrationSource } from "./update-integration-source";
import { FakeIntegrationSourceStore } from "./test-support";

const ORG = "org-1";
const ACTOR = "user-1";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    actorId: ACTOR,
    name: "Medusa",
    systemType: "medusa",
    credentialsOwner: "TECH",
    ...overrides,
  };
}

async function seed(store: FakeIntegrationSourceStore): Promise<string> {
  const { integrationSourceId } = await registerIntegrationSource(store, baseInput());
  return integrationSourceId;
}

describe("updateIntegrationSource", () => {
  it("updates the editable fields, stamps the audit columns and audits before/after", async () => {
    const store = new FakeIntegrationSourceStore();
    const id = await seed(store);

    await updateIntegrationSource(store, {
      ...baseInput(),
      integrationSourceId: id,
      name: "Medusa Cloud",
      direction: "read",
      rateLimitNote: "60 req/min",
      active: false,
    });

    expect(store.sources[0]).toMatchObject({
      id,
      name: "Medusa Cloud",
      rateLimitNote: "60 req/min",
      active: false,
      updatedBy: ACTOR,
    });
    expect(store.sources[0]?.updatedAt).toBeInstanceOf(Date);
    expect(store.audits.at(-1)).toMatchObject({
      action: "integrations.integration_source.updated",
      entityType: "integration_source",
      entityId: id,
      before: expect.objectContaining({ name: "Medusa" }),
      after: expect.objectContaining({ name: "Medusa Cloud" }),
    });
  });

  it("refuses an unknown or foreign-organization id", async () => {
    const store = new FakeIntegrationSourceStore();
    const id = await seed(store);

    await expect(
      updateIntegrationSource(store, { ...baseInput(), integrationSourceId: "missing" }),
    ).rejects.toThrow(/integration source not found in organization/);
    await expect(
      updateIntegrationSource(store, {
        ...baseInput({ organizationId: "org-2" }),
        integrationSourceId: id,
      }),
    ).rejects.toThrow(/integration source not found in organization/);
  });

  it("refuses a rename onto another source's name", async () => {
    const store = new FakeIntegrationSourceStore();
    const id = await seed(store);
    await registerIntegrationSource(store, baseInput({ name: "Sanity", systemType: "sanity" }));

    await expect(
      updateIntegrationSource(store, { ...baseInput(), integrationSourceId: id, name: "Sanity" }),
    ).rejects.toThrow(/name "Sanity" already exists/);
  });

  it("allows keeping its own name", async () => {
    const store = new FakeIntegrationSourceStore();
    const id = await seed(store);
    await expect(
      updateIntegrationSource(store, {
        ...baseInput(),
        integrationSourceId: id,
        name: "Medusa",
        rateLimitNote: "updated",
      }),
    ).resolves.toEqual({ integrationSourceId: id });
  });

  it("enforces the write-requires-approved-terms invariant on update (DEC-015)", async () => {
    const store = new FakeIntegrationSourceStore();
    const id = await seed(store);

    await expect(
      updateIntegrationSource(store, {
        ...baseInput(),
        integrationSourceId: id,
        allowedOperations: ["read", "write_price"],
        termsStatus: "rejected",
      }),
    ).rejects.toThrow(/write operation only when termsStatus is "approved"/);
  });
});
