import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { DEFAULT_CHANNEL_LIMIT, MAX_CHANNEL_LIMIT, listChannels } from "./list-channels";
import type { ChannelListRecord } from "./read-types";
import { FakeCostingReadStore, seedCostingReadFixture } from "./read-test-support";

function channel(
  overrides: Partial<ChannelListRecord> & {
    readonly id: string;
    readonly organizationId: string;
    readonly code: string;
  },
): ChannelListRecord {
  return {
    name: overrides.code,
    isDelivery: false,
    ...overrides,
  };
}

function buildStore(): FakeCostingReadStore {
  const store = new FakeCostingReadStore();
  const { organizationId, otherOrganizationId } = seedCostingReadFixture(store);
  store.channels.set(
    "chan-alpha",
    channel({ id: "chan-alpha", organizationId, code: "ALPHA", name: "Alpha" }),
  );
  store.channels.set(
    "chan-zulu",
    channel({ id: "chan-zulu", organizationId, code: "ZULU", name: "Zulu", isDelivery: true }),
  );
  store.channels.set(
    "chan-foreign",
    channel({ id: "chan-foreign", organizationId: otherOrganizationId, code: "AAA" }),
  );
  return store;
}

describe("listChannels", () => {
  it("returns only the organization's channels ordered by code", async () => {
    const store = buildStore();
    const rows = await listChannels(store, { organizationId: "org" });
    expect(rows.map((row) => row.id)).toEqual(["chan-alpha", "channel", "chan-zulu"]);
    expect(rows.map((row) => row.code)).toEqual(["ALPHA", "IN_STORE", "ZULU"]);
    expect(DEFAULT_CHANNEL_LIMIT).toBe(50);
  });

  it("filters by delivery flag", async () => {
    const store = buildStore();
    const delivery = await listChannels(store, { organizationId: "org", isDelivery: true });
    expect(delivery.map((row) => row.id)).toEqual(["chan-zulu"]);

    const inStore = await listChannels(store, { organizationId: "org", isDelivery: false });
    expect(inStore.map((row) => row.id)).toEqual(["chan-alpha", "channel"]);
  });

  it("applies the offset over the bounded page", async () => {
    const store = buildStore();
    const rows = await listChannels(store, { organizationId: "org", limit: 1, offset: 1 });
    expect(rows.map((row) => row.id)).toEqual(["channel"]);
  });

  it("rejects an out-of-range limit and a negative offset", async () => {
    const store = buildStore();
    await expect(listChannels(store, { organizationId: "org", limit: 0 })).rejects.toThrow(
      DomainError,
    );
    await expect(
      listChannels(store, { organizationId: "org", limit: MAX_CHANNEL_LIMIT + 1 }),
    ).rejects.toThrow(DomainError);
    await expect(listChannels(store, { organizationId: "org", offset: -1 })).rejects.toThrow(
      DomainError,
    );
  });
});
