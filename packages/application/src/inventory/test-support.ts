import { recomputeStockBalance, type StockMovementValue } from "@aquarela/domain";

import type { AuditInput } from "../auth";
import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryMovementListQuery,
  InventoryOrganizationRecord,
  InventoryStorageAreaRecord,
  InventoryStore,
  InventoryUnitRecord,
  NewInventoryStorageAreaRecord,
  NewStockLotRecord,
  NewStockMovementRecord,
  StockBalanceKey,
  StockBalanceRecord,
  StockLotRecord,
  StockMovementRecord,
  StockMovementSumRecord,
} from "./types";

/** `NULLS NOT DISTINCT`-style key: an absent lot is its own bucket, not a wildcard. */
function balanceKeyOf(key: StockBalanceKey): string {
  return `${key.organizationId}\u0000${key.itemId}\u0000${key.locationId}\u0000${key.storageAreaId}\u0000${key.lotId ?? "\u0000null"}`;
}

/**
 * In-memory `InventoryStore` for the unit suite. It mirrors the observable
 * contract of `createPostgresInventoryStore` closely enough to exercise the
 * commands without a database; `inventory.postgres.test.ts` covers the real
 * adapter.
 */
export class FakeInventoryStore implements InventoryStore {
  readonly organizations = new Map<string, InventoryOrganizationRecord>();
  readonly items = new Map<string, InventoryItemRecord>();
  readonly locations = new Map<string, InventoryLocationRecord>();
  readonly units = new Map<string, InventoryUnitRecord>();
  readonly storageAreas = new Map<string, InventoryStorageAreaRecord>();
  readonly stockLots = new Map<string, StockLotRecord>();
  readonly stockMovements = new Map<string, StockMovementRecord>();
  readonly stockBalances = new Map<string, StockBalanceRecord>();
  readonly audits: AuditInput[] = [];
  /** Role codes per actor; an absent actor has none (fail-closed). */
  readonly actorRoles = new Map<string, readonly string[]>();

  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async withTransaction<T>(fn: (store: InventoryStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  findOrganization(organizationId: string): Promise<InventoryOrganizationRecord | undefined> {
    return Promise.resolve(this.organizations.get(organizationId));
  }

  findItem(itemId: string): Promise<InventoryItemRecord | undefined> {
    return Promise.resolve(this.items.get(itemId));
  }

  findLocation(locationId: string): Promise<InventoryLocationRecord | undefined> {
    return Promise.resolve(this.locations.get(locationId));
  }

  setLocationDefaultStorageArea(query: {
    readonly organizationId: string;
    readonly locationId: string;
    readonly storageAreaId: string;
  }): Promise<InventoryLocationRecord | undefined> {
    const existing = this.locations.get(query.locationId);
    if (existing === undefined || existing.organizationId !== query.organizationId) {
      return Promise.resolve(undefined);
    }
    const record: InventoryLocationRecord = {
      ...existing,
      defaultStorageAreaId: query.storageAreaId,
    };
    this.locations.set(record.id, record);
    return Promise.resolve(record);
  }

  findStorageArea(storageAreaId: string): Promise<InventoryStorageAreaRecord | undefined> {
    return Promise.resolve(this.storageAreas.get(storageAreaId));
  }

  findStorageAreaByCode(query: {
    readonly organizationId: string;
    readonly locationId: string;
    readonly code: string;
  }): Promise<InventoryStorageAreaRecord | undefined> {
    for (const area of this.storageAreas.values()) {
      if (
        area.organizationId === query.organizationId &&
        area.locationId === query.locationId &&
        area.code === query.code
      ) {
        return Promise.resolve(area);
      }
    }
    return Promise.resolve(undefined);
  }

  createStorageArea(input: NewInventoryStorageAreaRecord): Promise<InventoryStorageAreaRecord> {
    const record: InventoryStorageAreaRecord = { id: this.nextId("storage-area"), ...input };
    this.storageAreas.set(record.id, record);
    return Promise.resolve(record);
  }

  findUnit(unitId: string): Promise<InventoryUnitRecord | undefined> {
    return Promise.resolve(this.units.get(unitId));
  }

  findStockLot(lotId: string): Promise<StockLotRecord | undefined> {
    return Promise.resolve(this.stockLots.get(lotId));
  }

  findOrCreateStockLot(input: NewStockLotRecord): Promise<StockLotRecord> {
    // A null lot number is not addressable by the natural key (Postgres unique
    // indexes treat NULLs as distinct), so always insert a fresh lot, matching
    // the adapter's insert-and-return path.
    if (input.lotNumber !== null) {
      for (const lot of this.stockLots.values()) {
        if (
          lot.organizationId === input.organizationId &&
          lot.itemId === input.itemId &&
          lot.locationId === input.locationId &&
          lot.lotNumber === input.lotNumber
        ) {
          return Promise.resolve(lot);
        }
      }
    }
    return this.createStockLot(input);
  }

  createStockLot(input: NewStockLotRecord): Promise<StockLotRecord> {
    const record: StockLotRecord = {
      id: this.nextId("lot"),
      ...input,
      receivedAt: input.receivedAt === null ? null : new Date(input.receivedAt).toISOString(),
    };
    this.stockLots.set(record.id, record);
    return Promise.resolve(record);
  }

  findStockMovement(id: string): Promise<StockMovementRecord | undefined> {
    return Promise.resolve(this.stockMovements.get(id));
  }

  findStockMovementByIdempotencyKey(
    organizationId: string,
    key: string,
  ): Promise<StockMovementRecord | undefined> {
    for (const movement of this.stockMovements.values()) {
      if (movement.organizationId === organizationId && movement.idempotencyKey === key) {
        return Promise.resolve(movement);
      }
    }
    return Promise.resolve(undefined);
  }

  findStockMovementReversal(movementId: string): Promise<StockMovementRecord | undefined> {
    for (const movement of this.stockMovements.values()) {
      if (movement.reversalOfId === movementId) {
        return Promise.resolve(movement);
      }
    }
    return Promise.resolve(undefined);
  }

  lockStockBalance(key: StockBalanceKey, at: Date): Promise<StockBalanceRecord> {
    const id = balanceKeyOf(key);
    const existing = this.stockBalances.get(id);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    const record: StockBalanceRecord = {
      id: this.nextId("balance"),
      ...key,
      quantityOnHand: "0.000000",
      valueOnHand: "0.0000",
      avgUnitCost: null,
      asOf: at.toISOString(),
    };
    this.stockBalances.set(id, record);
    return Promise.resolve(record);
  }

  findStockBalance(key: StockBalanceKey): Promise<StockBalanceRecord | undefined> {
    return Promise.resolve(this.stockBalances.get(balanceKeyOf(key)));
  }

  async saveStockBalance(
    key: StockBalanceKey,
    values: {
      readonly quantityOnHand: string;
      readonly valueOnHand: string;
      readonly avgUnitCost: string | null;
      readonly asOf: Date;
    },
  ): Promise<StockBalanceRecord> {
    const id = balanceKeyOf(key);
    const existing = this.stockBalances.get(id);
    // Mirrors the Postgres adapter: the balance row must exist (the caller must
    // `lockStockBalance` first), so an unlocked save is a hard error here too.
    if (existing === undefined) {
      throw new Error(
        "saveStockBalance updated no row: callers must call lockStockBalance (or " +
          "lockOrCreateStockBalance) for the key before saving",
      );
    }
    const record: StockBalanceRecord = {
      id: existing.id,
      ...key,
      quantityOnHand: values.quantityOnHand,
      valueOnHand: values.valueOnHand,
      avgUnitCost: values.avgUnitCost,
      asOf: values.asOf.toISOString(),
    };
    this.stockBalances.set(id, record);
    return record;
  }

  createStockMovement(input: NewStockMovementRecord): Promise<StockMovementRecord> {
    const record: StockMovementRecord = {
      id: this.nextId("movement"),
      ...input,
      // Match the Postgres adapter's `toStockMovement`, which reads the
      // `timestamptz` back as `Date(...).toISOString()`, so the fake's ledger
      // order and as-of comparisons see the same canonical instant.
      occurredAt: new Date(input.occurredAt).toISOString(),
      postedAt: new Date().toISOString(),
    };
    this.stockMovements.set(record.id, record);
    return Promise.resolve(record);
  }

  listStockMovements(query: InventoryMovementListQuery): Promise<readonly StockMovementRecord[]> {
    const ledgerOrder = (a: StockMovementRecord, b: StockMovementRecord): number => {
      if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
      if (a.postedAt !== b.postedAt) return a.postedAt < b.postedAt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    };
    const from = query.occurredFrom?.toISOString();
    const to = query.occurredTo?.toISOString();
    let rows = [...this.stockMovements.values()]
      .filter((movement) => movement.organizationId === query.organizationId)
      .filter((movement) => query.itemId === undefined || movement.itemId === query.itemId)
      .filter(
        (movement) => query.locationId === undefined || movement.locationId === query.locationId,
      )
      .filter(
        (movement) =>
          query.storageAreaId === undefined || movement.storageAreaId === query.storageAreaId,
      )
      .filter(
        (movement) =>
          query.lotId === undefined ||
          (query.lotId === null ? movement.lotId === null : movement.lotId === query.lotId),
      )
      .filter(
        (movement) => query.sourceType === undefined || movement.sourceType === query.sourceType,
      )
      .filter((movement) => query.sourceId === undefined || movement.sourceId === query.sourceId)
      .filter(
        (movement) =>
          query.onlyReversible !== true ||
          (movement.reversalOfId === null &&
            ![...this.stockMovements.values()].some((other) => other.reversalOfId === movement.id)),
      )
      .filter((movement) => from === undefined || movement.occurredAt >= from)
      .filter((movement) => to === undefined || movement.occurredAt <= to)
      .sort(ledgerOrder);
    if (query.offset !== undefined) {
      rows = rows.slice(query.offset);
    }
    if (query.limit !== undefined) {
      rows = rows.slice(0, query.limit);
    }
    return Promise.resolve(rows);
  }

  listStorageAreas(query: {
    readonly organizationId: string;
    readonly locationId?: string;
  }): Promise<readonly InventoryStorageAreaRecord[]> {
    return Promise.resolve(
      [...this.storageAreas.values()]
        .filter((area) => area.organizationId === query.organizationId)
        .filter((area) => query.locationId === undefined || area.locationId === query.locationId)
        .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
    );
  }

  listStockedItems(query: {
    readonly organizationId: string;
  }): Promise<readonly InventoryItemRecord[]> {
    return Promise.resolve(
      [...this.items.values()]
        .filter((record) => record.organizationId === query.organizationId)
        .filter((record) => record.inventoryPolicy === "stocked")
        .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
    );
  }

  listLocations(query: {
    readonly organizationId: string;
  }): Promise<readonly InventoryLocationRecord[]> {
    return Promise.resolve(
      [...this.locations.values()]
        .filter((record) => record.organizationId === query.organizationId)
        .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
    );
  }

  sumStockMovementsAsOf(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly itemId?: string;
    readonly locationId?: string;
  }): Promise<readonly StockMovementSumRecord[]> {
    const asOf = query.asOf.toISOString();
    const groups = new Map<string, { key: StockBalanceKey; values: StockMovementValue[] }>();
    for (const movement of this.stockMovements.values()) {
      if (movement.organizationId !== query.organizationId) continue;
      if (query.itemId !== undefined && movement.itemId !== query.itemId) continue;
      if (query.locationId !== undefined && movement.locationId !== query.locationId) continue;
      if (movement.occurredAt > asOf) continue;
      const key: StockBalanceKey = {
        organizationId: movement.organizationId,
        itemId: movement.itemId,
        locationId: movement.locationId,
        storageAreaId: movement.storageAreaId,
        lotId: movement.lotId,
      };
      const groupKey = balanceKeyOf(key);
      let group = groups.get(groupKey);
      if (group === undefined) {
        group = { key, values: [] };
        groups.set(groupKey, group);
      }
      group.values.push({
        quantityDelta: movement.quantityDelta,
        valueDelta: movement.valueDelta ?? "0.0000",
      });
    }
    return Promise.resolve(
      [...groups.values()].map((group) => {
        const totals = recomputeStockBalance(group.values);
        return {
          organizationId: group.key.organizationId,
          itemId: group.key.itemId,
          locationId: group.key.locationId,
          storageAreaId: group.key.storageAreaId,
          lotId: group.key.lotId,
          quantityOnHand: totals.quantityOnHand,
          valueOnHand: totals.valueOnHand,
        };
      }),
    );
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
  }

  listActorRoleCodes(actorId: string): Promise<readonly string[]> {
    return Promise.resolve(this.actorRoles.get(actorId) ?? []);
  }
}

export interface InventoryFixture {
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly locationId: string;
  readonly otherLocationId: string;
  readonly transitLocationId: string;
  readonly storageAreaId: string;
  readonly unitId: string;
  readonly itemId: string;
}

/**
 * Seeds the common org/location/storage-area/unit/stocked-item fixture used by
 * the inventory unit tests. Fixed ids keep assertions readable; tests that need
 * a variation (non-stocked item, foreign lot, transit area) mutate the maps.
 */
export function seedInventoryFixture(store: FakeInventoryStore): InventoryFixture {
  const organizationId = "org";
  const otherOrganizationId = "org-other";
  const locationId = "loc";
  const otherLocationId = "loc-other";
  const transitLocationId = "loc-transit";
  const storageAreaId = "area";
  const unitId = "unit";
  const itemId = "item";

  store.organizations.set(organizationId, { id: organizationId, currency: "NOK" });
  store.organizations.set(otherOrganizationId, { id: otherOrganizationId, currency: "NOK" });
  store.locations.set(locationId, {
    id: locationId,
    organizationId,
    code: "MAIN",
    name: "Main",
    kind: "operating",
    defaultStorageAreaId: storageAreaId,
  });
  store.locations.set(otherLocationId, {
    id: otherLocationId,
    organizationId,
    code: "OTHER",
    name: "Other",
    kind: "operating",
    defaultStorageAreaId: null,
  });
  store.locations.set(transitLocationId, {
    id: transitLocationId,
    organizationId,
    code: "TRANSIT",
    name: "Transit",
    kind: "virtual_transit",
    defaultStorageAreaId: null,
  });
  store.storageAreas.set(storageAreaId, {
    id: storageAreaId,
    organizationId,
    locationId,
    code: "DRY",
    name: "Dry store",
    kind: "dry_store",
    isTransit: false,
  });
  store.units.set(unitId, { id: unitId, organizationId, code: "kg", dimension: "mass" });
  store.items.set(itemId, {
    id: itemId,
    organizationId,
    code: "ITEM",
    name: "Test item",
    baseUnitId: unitId,
    inventoryPolicy: "stocked",
    lotTracked: false,
  });
  // The default test actor holds `owner`, so DEC-010's negative override is
  // authorized; tests that need an unauthorized actor use another id — the role
  // map is fail-closed, so an absent actor has no roles.
  store.actorRoles.set("actor", ["owner"]);

  return {
    organizationId,
    otherOrganizationId,
    locationId,
    otherLocationId,
    transitLocationId,
    storageAreaId,
    unitId,
    itemId,
  };
}
