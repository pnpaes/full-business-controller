import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { listWasteEvents } from "./list-waste-events";
import { FakeWasteStore } from "./test-support";

const ORG = "org";
const OTHER_ORG = "org-other";
const LOCATION = "loc";

function event(overrides: {
  organizationId?: string;
  itemId?: string;
  stage?: string;
  occurredAt?: string;
}): Parameters<FakeWasteStore["createWasteEvent"]>[0] {
  return {
    organizationId: overrides.organizationId ?? ORG,
    locationId: LOCATION,
    storageAreaId: "area",
    itemId: overrides.itemId ?? "item",
    productVariantId: null,
    productionBatchId: null,
    quantity: "1.000000",
    unitId: "unit",
    stage: overrides.stage ?? "storage_expiry",
    reasonCode: overrides.stage ?? "storage_expiry",
    valueMethod: "moving_average",
    value: "1.0000",
    currency: "NOK",
    occurredAt: overrides.occurredAt ?? "2026-01-01T00:00:00.000Z",
    actorId: "actor",
    photoFileId: null,
    correctiveAction: null,
    snapshotId: null,
  };
}

describe("listWasteEvents", () => {
  it("returns newest first and derives hasMore from one extra row", async () => {
    const store = new FakeWasteStore();
    await store.createWasteEvent(event({ occurredAt: "2026-01-01T00:00:00.000Z" }));
    const march = await store.createWasteEvent(event({ occurredAt: "2026-03-01T00:00:00.000Z" }));
    const february = await store.createWasteEvent(
      event({ occurredAt: "2026-02-01T00:00:00.000Z" }),
    );

    const page = await listWasteEvents(store, { organizationId: ORG, limit: 2 });
    expect(page.events.map((row) => row.id)).toEqual([march.id, february.id]);
    expect(page.hasMore).toBe(true);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(0);

    const rest = await listWasteEvents(store, { organizationId: ORG, limit: 2, offset: 2 });
    expect(rest.events).toHaveLength(1);
    expect(rest.hasMore).toBe(false);
  });

  it("filters by stage and occurred_at window", async () => {
    const store = new FakeWasteStore();
    const display = await store.createWasteEvent(
      event({ stage: "display", occurredAt: "2026-03-01T00:00:00.000Z" }),
    );
    await store.createWasteEvent(
      event({ stage: "preparation", occurredAt: "2026-01-01T00:00:00.000Z" }),
    );

    const windowed = await listWasteEvents(store, {
      organizationId: ORG,
      stage: "display",
      occurredFrom: "2026-02-01T00:00:00.000Z",
      occurredTo: "2026-04-01T00:00:00.000Z",
    });
    expect(windowed.events.map((row) => row.id)).toEqual([display.id]);
  });

  it("never returns another organization's events", async () => {
    const store = new FakeWasteStore();
    await store.createWasteEvent(event({ organizationId: OTHER_ORG }));

    const page = await listWasteEvents(store, { organizationId: ORG });
    expect(page.events).toEqual([]);
  });

  it("rejects a malformed instant, limit or offset before touching the store", async () => {
    const store = new FakeWasteStore();
    await expect(
      listWasteEvents(store, { organizationId: ORG, occurredFrom: "not-an-instant" }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(listWasteEvents(store, { organizationId: ORG, limit: 0 })).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(
      listWasteEvents(store, { organizationId: ORG, limit: 201 }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      listWasteEvents(store, { organizationId: ORG, offset: -1 }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
