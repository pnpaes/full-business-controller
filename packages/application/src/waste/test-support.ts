import { FakeInventoryStore, seedInventoryFixture } from "../inventory/test-support";
import type { InventoryFixture } from "../inventory/test-support";

import type {
  NewWasteEventRecord,
  WasteEventRecord,
  WasteEventListQuery,
  WasteProductVariantRecord,
  WasteStore,
} from "./types";

/**
 * In-memory `WasteStore` for the unit suite: it extends `FakeInventoryStore` so
 * the command can post the ledger movement through the same `postStockMovement`
 * path the real adapter uses. `waste.postgres.test.ts` covers the real adapter
 * (including the `0020` source-id trigger ordering).
 */
export class FakeWasteStore extends FakeInventoryStore implements WasteStore {
  readonly wasteEvents = new Map<string, WasteEventRecord>();
  readonly productVariants = new Map<string, WasteProductVariantRecord>();
  private wasteSequence = 0;

  override async withTransaction<T>(fn: (store: WasteStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  findProductVariant(productVariantId: string): Promise<WasteProductVariantRecord | undefined> {
    return Promise.resolve(this.productVariants.get(productVariantId));
  }

  createWasteEvent(input: NewWasteEventRecord): Promise<WasteEventRecord> {
    this.wasteSequence += 1;
    const record: WasteEventRecord = {
      id: `waste-${this.wasteSequence}`,
      ...input,
      // Match the adapter's `toWasteEvent`, which reads the `timestamptz` back as
      // `Date(...).toISOString()`.
      occurredAt: new Date(input.occurredAt).toISOString(),
    };
    this.wasteEvents.set(record.id, record);
    return Promise.resolve(record);
  }

  findWasteEvent(query: {
    readonly organizationId: string;
    readonly wasteEventId: string;
  }): Promise<WasteEventRecord | undefined> {
    const event = this.wasteEvents.get(query.wasteEventId);
    return Promise.resolve(
      event !== undefined && event.organizationId === query.organizationId ? event : undefined,
    );
  }

  listWasteEvents(query: WasteEventListQuery): Promise<readonly WasteEventRecord[]> {
    const from = query.occurredFrom?.toISOString();
    const to = query.occurredTo?.toISOString();
    let rows = [...this.wasteEvents.values()]
      .filter((event) => event.organizationId === query.organizationId)
      .filter((event) => query.locationId === undefined || event.locationId === query.locationId)
      .filter((event) => query.itemId === undefined || event.itemId === query.itemId)
      .filter((event) => query.stage === undefined || event.stage === query.stage)
      .filter((event) => from === undefined || event.occurredAt >= from)
      .filter((event) => to === undefined || event.occurredAt <= to)
      .sort((a, b) => {
        if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      });
    if (query.offset !== undefined) {
      rows = rows.slice(query.offset);
    }
    if (query.limit !== undefined) {
      rows = rows.slice(0, query.limit);
    }
    return Promise.resolve(rows);
  }
}

export interface WasteFixture extends InventoryFixture {
  readonly otherItemId: string;
  readonly productVariantId: string;
}

/**
 * Seeds the inventory fixture plus a second stocked item and a product variant
 * whose finished-good item is the primary fixture item (the variant branch of
 * `recordWasteEvent`).
 */
export function seedWasteFixture(store: FakeWasteStore): WasteFixture {
  const fixture = seedInventoryFixture(store);
  const otherItemId = "item-other";
  store.items.set(otherItemId, {
    id: otherItemId,
    organizationId: fixture.organizationId,
    code: "ITEM2",
    name: "Second item",
    baseUnitId: fixture.unitId,
    inventoryPolicy: "stocked",
    lotTracked: false,
  });
  const productVariantId = "variant";
  store.productVariants.set(productVariantId, {
    id: productVariantId,
    organizationId: fixture.organizationId,
    code: "VAR",
    name: "Variant",
    finishedGoodItemId: fixture.itemId,
  });
  return { ...fixture, otherItemId, productVariantId };
}
