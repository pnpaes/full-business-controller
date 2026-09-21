import type { AuditInput } from "../auth";
import {
  createFakeDataQualityException,
  type DataQualityExceptionRecord,
  type NewDataQualityExceptionRecord,
} from "../data-quality";
import type { StockBalanceRecord, StockLotRecord, StockMovementRecord } from "../inventory";
import {
  FakeInventoryStore,
  seedInventoryFixture,
  type InventoryFixture,
} from "../inventory/test-support";

import type {
  CountItemRecord,
  CountStore,
  NewStockCountLineRecord,
  NewStockCountRecord,
  StockCountLineKey,
  StockCountLineRecord,
  StockCountRecord,
  UpdateStockCountLineValues,
  UpdateStockCountValues,
} from "./types";

/** `NULLS NOT DISTINCT`-style key: an absent lot is its own bucket, not a wildcard. */
function lineKeyOf(key: StockCountLineKey): string {
  return `${key.stockCountId}\u0000${key.itemId}\u0000${key.storageAreaId}\u0000${key.lotId ?? "\u0000null"}`;
}

/**
 * A shallow copy of every mutable map/array a count transaction can touch, used
 * to roll back a failed `withTransaction` (the base fake runs inline).
 */
interface CountSnapshot {
  readonly stockBalances: Map<string, StockBalanceRecord>;
  readonly stockMovements: Map<string, StockMovementRecord>;
  readonly stockLots: Map<string, StockLotRecord>;
  readonly audits: AuditInput[];
  readonly stockCounts: Map<string, StockCountRecord>;
  readonly stockCountLines: Map<string, StockCountLineRecord>;
  readonly itemCosts: Map<string, string>;
  readonly dataQualityExceptions: Map<string, DataQualityExceptionRecord>;
}

/**
 * In-memory `CountStore` for the unit suite. It composes `FakeInventoryStore`,
 * so the approval command runs the real `postStockMovements` path against the
 * same fake ledger; `counts.postgres.test.ts` covers the real adapter.
 */
export class FakeCountStore extends FakeInventoryStore implements CountStore {
  readonly stockCounts = new Map<string, StockCountRecord>();
  readonly stockCountLines = new Map<string, StockCountLineRecord>();
  /** Item running cost keyed by item id; missing = never costed (null). */
  readonly itemCosts = new Map<string, string>();
  /** `DEC-080` data-quality exceptions, in insertion order. */
  readonly dataQualityExceptions = new Map<string, DataQualityExceptionRecord>();

  private countSequence = 0;

  private nextCountId(prefix: string): string {
    this.countSequence += 1;
    return `${prefix}-${this.countSequence}`;
  }

  override async withTransaction<T>(fn: (store: CountStore) => Promise<T>): Promise<T> {
    // The base fake runs inline; this override adds rollback so the atomic
    // approval path can be tested (a failure mid-approval leaves no partial
    // postings, line variances, header change or exception behind).
    const snapshot = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  private snapshot(): CountSnapshot {
    return {
      stockBalances: new Map(this.stockBalances),
      stockMovements: new Map(this.stockMovements),
      stockLots: new Map(this.stockLots),
      audits: [...this.audits],
      stockCounts: new Map(this.stockCounts),
      stockCountLines: new Map(this.stockCountLines),
      itemCosts: new Map(this.itemCosts),
      dataQualityExceptions: new Map(this.dataQualityExceptions),
    };
  }

  private restore(snapshot: CountSnapshot): void {
    this.stockBalances.clear();
    for (const [key, value] of snapshot.stockBalances) this.stockBalances.set(key, value);
    this.stockMovements.clear();
    for (const [key, value] of snapshot.stockMovements) this.stockMovements.set(key, value);
    this.stockLots.clear();
    for (const [key, value] of snapshot.stockLots) this.stockLots.set(key, value);
    this.audits.length = 0;
    this.audits.push(...snapshot.audits);
    this.stockCounts.clear();
    for (const [key, value] of snapshot.stockCounts) this.stockCounts.set(key, value);
    this.stockCountLines.clear();
    for (const [key, value] of snapshot.stockCountLines) this.stockCountLines.set(key, value);
    this.itemCosts.clear();
    for (const [key, value] of snapshot.itemCosts) this.itemCosts.set(key, value);
    this.dataQualityExceptions.clear();
    for (const [key, value] of snapshot.dataQualityExceptions) {
      this.dataQualityExceptions.set(key, value);
    }
  }

  findStockCount(query: {
    readonly organizationId: string;
    readonly stockCountId: string;
  }): Promise<StockCountRecord | undefined> {
    const count = this.stockCounts.get(query.stockCountId);
    return Promise.resolve(
      count !== undefined && count.organizationId === query.organizationId ? count : undefined,
    );
  }

  listStockCounts(query: {
    readonly organizationId: string;
    readonly locationId?: string;
    readonly status?: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly StockCountRecord[]> {
    const rows = [...this.stockCounts.values()]
      .filter((count) => count.organizationId === query.organizationId)
      .filter((count) => query.locationId === undefined || count.locationId === query.locationId)
      .filter((count) => query.status === undefined || count.status === query.status)
      .sort((a, b) => {
        if (a.cutoff !== b.cutoff) return a.cutoff < b.cutoff ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return Promise.resolve(rows.slice(offset, offset + limit));
  }

  createStockCount(input: NewStockCountRecord): Promise<StockCountRecord> {
    const record: StockCountRecord = {
      id: input.id ?? this.nextCountId("count"),
      organizationId: input.organizationId,
      locationId: input.locationId,
      scope: input.scope,
      blind: input.blind,
      cutoff: input.cutoff,
      status: input.status,
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
    };
    this.stockCounts.set(record.id, record);
    return Promise.resolve(record);
  }

  updateStockCount(id: string, values: UpdateStockCountValues): Promise<StockCountRecord> {
    const existing = this.stockCounts.get(id);
    if (existing === undefined) {
      throw new Error("stock_count not found for update");
    }
    const record: StockCountRecord = {
      ...existing,
      ...(values.status === undefined ? {} : { status: values.status }),
      ...(values.approvedBy === undefined ? {} : { approvedBy: values.approvedBy }),
      ...(values.approvedAt === undefined ? {} : { approvedAt: values.approvedAt }),
    };
    this.stockCounts.set(id, record);
    return Promise.resolve(record);
  }

  listStockCountLines(query: {
    readonly organizationId: string;
    readonly stockCountId: string;
  }): Promise<readonly StockCountLineRecord[]> {
    const count = this.stockCounts.get(query.stockCountId);
    if (count === undefined || count.organizationId !== query.organizationId) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      [...this.stockCountLines.values()].filter((line) => line.stockCountId === query.stockCountId),
    );
  }

  findStockCountLine(
    query: StockCountLineKey & { readonly organizationId: string },
  ): Promise<StockCountLineRecord | undefined> {
    const count = this.stockCounts.get(query.stockCountId);
    if (count === undefined || count.organizationId !== query.organizationId) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.stockCountLines.get(lineKeyOf(query)));
  }

  createStockCountLine(input: NewStockCountLineRecord): Promise<StockCountLineRecord> {
    const record: StockCountLineRecord = { id: this.nextCountId("count-line"), ...input };
    this.stockCountLines.set(
      lineKeyOf({
        stockCountId: input.stockCountId,
        itemId: input.itemId,
        storageAreaId: input.storageAreaId,
        lotId: input.lotId,
      }),
      record,
    );
    return Promise.resolve(record);
  }

  findOrCreateStockCountLine(input: NewStockCountLineRecord): Promise<StockCountLineRecord> {
    const existing = this.stockCountLines.get(
      lineKeyOf({
        stockCountId: input.stockCountId,
        itemId: input.itemId,
        storageAreaId: input.storageAreaId,
        lotId: input.lotId,
      }),
    );
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    return this.createStockCountLine(input);
  }

  updateStockCountLine(
    id: string,
    values: UpdateStockCountLineValues,
  ): Promise<StockCountLineRecord> {
    const existing = [...this.stockCountLines.values()].find((line) => line.id === id);
    if (existing === undefined) {
      throw new Error("stock_count_line not found for update");
    }
    const record: StockCountLineRecord = {
      ...existing,
      ...(values.countedQty === undefined ? {} : { countedQty: values.countedQty }),
      ...(values.varianceQty === undefined ? {} : { varianceQty: values.varianceQty }),
      ...(values.reasonCode === undefined ? {} : { reasonCode: values.reasonCode }),
      ...(values.recount === undefined ? {} : { recount: values.recount }),
    };
    this.stockCountLines.set(
      lineKeyOf({
        stockCountId: existing.stockCountId,
        itemId: existing.itemId,
        storageAreaId: existing.storageAreaId,
        lotId: existing.lotId,
      }),
      record,
    );
    return Promise.resolve(record);
  }

  findCountItem(itemId: string): Promise<CountItemRecord | undefined> {
    const item = this.items.get(itemId);
    if (item === undefined) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({ ...item, currentCost: this.itemCosts.get(itemId) ?? null });
  }

  createDataQualityException(
    input: NewDataQualityExceptionRecord,
  ): Promise<DataQualityExceptionRecord> {
    return createFakeDataQualityException(this.dataQualityExceptions, input);
  }
}

export interface CountFixture extends InventoryFixture {
  /** A second stocked item, for multi-line counts. */
  readonly secondItemId: string;
}

/**
 * Seeds the common fixture for the counts tests: the inventory fixture plus a
 * second stocked item and a running cost on the first, so a positive variance
 * can fall back to `current_cost`.
 */
export function seedCountFixture(store: FakeCountStore): CountFixture {
  const fixture = seedInventoryFixture(store);
  const secondItemId = "item-2";
  store.items.set(secondItemId, {
    id: secondItemId,
    organizationId: fixture.organizationId,
    code: "ITEM2",
    name: "Second test item",
    baseUnitId: fixture.unitId,
    inventoryPolicy: "stocked",
    lotTracked: false,
  });
  store.itemCosts.set(fixture.itemId, "5.0000");
  return { ...fixture, secondItemId };
}
