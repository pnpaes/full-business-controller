import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTEGRATION_SOURCE_LIMIT,
  MAX_INTEGRATION_SOURCE_LIMIT,
  listIntegrationSources,
} from "./list-integration-sources";
import type { IntegrationSourceRecord } from "./read-types";
import { FakeIntegrationSourceStore } from "./test-support";

function source(
  overrides: Partial<IntegrationSourceRecord> & { readonly id: string },
): IntegrationSourceRecord {
  return {
    organizationId: "org",
    name: overrides.id,
    systemType: "other",
    direction: "read",
    allowedOperations: [],
    credentialsOwner: "TECH",
    rateLimitNote: null,
    termsStatus: "pending",
    active: true,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

function buildStore(): FakeIntegrationSourceStore {
  const store = new FakeIntegrationSourceStore();
  store.sources.push(
    source({ id: "zulu", name: "Wolt", systemType: "wolt" }),
    source({ id: "alpha", name: "Fiken", systemType: "fiken" }),
    source({ id: "foreign", name: "AAA", organizationId: "org-other" }),
  );
  return store;
}

describe("listIntegrationSources", () => {
  it("returns only the organization's sources ordered by name", async () => {
    const store = buildStore();
    const rows = await listIntegrationSources(store, { organizationId: "org" });
    expect(rows.map((row) => row.name)).toEqual(["Fiken", "Wolt"]);
    expect(DEFAULT_INTEGRATION_SOURCE_LIMIT).toBe(50);
  });

  it("applies the bounded page over the ordering", async () => {
    const store = buildStore();
    const rows = await listIntegrationSources(store, {
      organizationId: "org",
      limit: 1,
      offset: 1,
    });
    expect(rows.map((row) => row.name)).toEqual(["Wolt"]);
  });

  it("drops cross-organization rows as defence in depth", async () => {
    const store = buildStore();
    const rows = await listIntegrationSources(store, { organizationId: "org" });
    expect(rows.every((row) => row.organizationId === "org")).toBe(true);
  });

  it("rejects an out-of-range limit and a negative offset", async () => {
    const store = buildStore();
    await expect(
      listIntegrationSources(store, { organizationId: "org", limit: 0 }),
    ).rejects.toThrow(DomainError);
    await expect(
      listIntegrationSources(store, {
        organizationId: "org",
        limit: MAX_INTEGRATION_SOURCE_LIMIT + 1,
      }),
    ).rejects.toThrow(DomainError);
    await expect(
      listIntegrationSources(store, { organizationId: "org", offset: -1 }),
    ).rejects.toThrow(/offset must be a non-negative integer/);
  });
});
