import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for slice-8 stock ledger + balances +
 * lots/storage. The store is a narrow port over `@aquarela/persistence` so the
 * commands can be unit-tested against an in-memory fake; `createPostgresInventoryStore`
 * is the real adapter. Record types are structural subsets of the persistence
 * rows; `timestamptz` columns are carried as ISO strings and `date` columns as
 * `yyyy-mm-dd` strings (see the adapter's `toX` mappers).
 *
 * Record names are `Inventory`-prefixed where the bare name would collide in the
 * `export *` application barrel (e.g. `catalog` already exports `MasterUnit`,
 * and `costing` exports `LocationRecord`). The prefixed names are also the local
 * vocabulary of this slice.
 */

export interface InventoryItemRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly baseUnitId: string;
  readonly inventoryPolicy: string;
  readonly lotTracked: boolean;
}

/** `kind` is needed for the `is_transit` storage-area rule (DATA_DICTIONARY §4). */
export interface InventoryLocationRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  /**
   * `DEC-145`: the location's default storage area, a fallback for a receipt
   * with no explicit override. Nullable and expand-only; the resolution fails
   * closed when a receipt has neither an override nor a default. Optional so a
   * read projection that does not select it can omit it (treated as `null`).
   */
  readonly defaultStorageAreaId?: string | null;
}

export interface InventoryStorageAreaRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly isTransit: boolean;
}

export interface InventoryOrganizationRecord {
  readonly id: string;
  readonly currency: string;
}

export interface InventoryUnitRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly dimension: string;
}

export interface StockLotRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly lotNumber: string | null;
  /** `date`. */
  readonly expiryDate: string | null;
  /** `date`. */
  readonly openedDate: string | null;
  /** `timestamptz`. */
  readonly receivedAt: string | null;
  readonly sourceMovementId: string | null;
}

export interface StockMovementRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly itemId: string;
  readonly lotId: string | null;
  readonly movementType: string;
  /** numeric(19,6), signed. */
  readonly quantityDelta: string;
  readonly unitId: string;
  /** numeric(19,4). */
  readonly unitCost: string | null;
  /** numeric(19,4), signed. */
  readonly valueDelta: string | null;
  readonly currency: string | null;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly reversalOfId: string | null;
  /** `timestamptz`. */
  readonly occurredAt: string;
  /** `timestamptz`. */
  readonly postedAt: string;
  readonly postedBy: string;
  readonly reasonCode: string | null;
  readonly idempotencyKey: string | null;
}

export interface StockBalanceRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly lotId: string | null;
  /** numeric(19,6). */
  readonly quantityOnHand: string;
  /** numeric(19,4). */
  readonly valueOnHand: string;
  /** numeric(19,4), null at zero quantity. */
  readonly avgUnitCost: string | null;
  /** `timestamptz`. */
  readonly asOf: string;
}

/** The identity of a projected `stock_balance` row; `lotId` null = no lot. */
export interface StockBalanceKey {
  readonly organizationId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly lotId: string | null;
}

/**
 * Per-`(item, location, storage_area, lot)` movement sums at a cutoff, aggregated
 * by the store rather than loaded row-by-row. Both totals are canonical text at
 * the ledger scale (quantity numeric(19,6), value numeric(19,4)); the average is
 * deliberately not computed here (the application derives it via the domain).
 */
export interface StockMovementSumRecord {
  readonly organizationId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly lotId: string | null;
  /** numeric(19,6). */
  readonly quantityOnHand: string;
  /** numeric(19,4). */
  readonly valueOnHand: string;
}

export interface NewStockMovementRecord {
  readonly organizationId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly itemId: string;
  readonly lotId: string | null;
  readonly movementType: string;
  readonly quantityDelta: string;
  readonly unitId: string;
  readonly unitCost: string | null;
  readonly valueDelta: string;
  readonly currency: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly reversalOfId: string | null;
  /** ISO timestamp. */
  readonly occurredAt: string;
  readonly postedBy: string;
  readonly reasonCode: string | null;
  readonly idempotencyKey: string | null;
}

export interface NewStockLotRecord {
  readonly organizationId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly openedDate: string | null;
  readonly receivedAt: string | null;
  readonly sourceMovementId: string | null;
}

export interface NewInventoryStorageAreaRecord {
  readonly organizationId: string;
  readonly locationId: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly isTransit: boolean;
}

/**
 * Movement-list filters for the read API. The date window is `Date` here (the
 * adapter/application boundary), as `sumStockMovementsAsOf` already is; the read
 * service validates the caller's ISO strings before converting.
 */
export interface InventoryMovementListQuery {
  readonly organizationId: string;
  readonly itemId?: string;
  readonly locationId?: string;
  readonly storageAreaId?: string;
  /** Absent = no filter; `null` = match only the no-lot movements. */
  readonly lotId?: string | null;
  /** Filters `source_type`; pair with `sourceId` for one posted source (`DEC-116`). */
  readonly sourceType?: string;
  /** Filters `source_id` (`DEC-116`). */
  readonly sourceId?: string;
  /**
   * Keep only originals not already reversed (`DEC-116`): excludes a movement
   * that is itself a reversal and one that already has one, so a
   * partially-reversed source lists only the still-correctable originals.
   */
  readonly onlyReversible?: boolean;
  readonly occurredFrom?: Date;
  readonly occurredTo?: Date;
  readonly limit?: number;
  readonly offset?: number;
}

export interface InventoryStore {
  /** Binds `fn` to one transaction so the posting and its audit row commit together. */
  withTransaction<T>(fn: (store: InventoryStore) => Promise<T>): Promise<T>;
  findOrganization(organizationId: string): Promise<InventoryOrganizationRecord | undefined>;
  findItem(itemId: string): Promise<InventoryItemRecord | undefined>;
  findLocation(locationId: string): Promise<InventoryLocationRecord | undefined>;
  /**
   * Sets a location's default storage area (`DEC-145`), org-scoped. The command
   * org-checks the location and asserts the area belongs to it first; the
   * `0074` coherence guard is the database backstop. `undefined` when no
   * location matched the organization.
   */
  setLocationDefaultStorageArea(query: {
    readonly organizationId: string;
    readonly locationId: string;
    readonly storageAreaId: string;
  }): Promise<InventoryLocationRecord | undefined>;
  findStorageArea(storageAreaId: string): Promise<InventoryStorageAreaRecord | undefined>;
  findStorageAreaByCode(query: {
    readonly organizationId: string;
    readonly locationId: string;
    readonly code: string;
  }): Promise<InventoryStorageAreaRecord | undefined>;
  createStorageArea(input: NewInventoryStorageAreaRecord): Promise<InventoryStorageAreaRecord>;
  findUnit(unitId: string): Promise<InventoryUnitRecord | undefined>;
  findStockLot(lotId: string): Promise<StockLotRecord | undefined>;
  /** Create-or-find by `(organization, item, location, lot number)`, race-safe. */
  findOrCreateStockLot(input: NewStockLotRecord): Promise<StockLotRecord>;
  findStockMovement(id: string): Promise<StockMovementRecord | undefined>;
  /**
   * The movement posted under `idempotencyKey` **within one organization**: the
   * ledger's key is a per-organization namespace, so a foreign organization's
   * key is simply not found here.
   */
  findStockMovementByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<StockMovementRecord | undefined>;
  /** The reversal movement posted against `movementId`, if any. */
  findStockMovementReversal(movementId: string): Promise<StockMovementRecord | undefined>;
  lockStockBalance(key: StockBalanceKey, at: Date): Promise<StockBalanceRecord>;
  findStockBalance(key: StockBalanceKey): Promise<StockBalanceRecord | undefined>;
  saveStockBalance(
    key: StockBalanceKey,
    values: {
      readonly quantityOnHand: string;
      readonly valueOnHand: string;
      readonly avgUnitCost: string | null;
      readonly asOf: Date;
    },
  ): Promise<StockBalanceRecord>;
  createStockMovement(input: NewStockMovementRecord): Promise<StockMovementRecord>;
  /** Ledger read (newest page via `offset`); `limit` is applied by the caller. */
  listStockMovements(query: InventoryMovementListQuery): Promise<readonly StockMovementRecord[]>;
  /** Storage areas for an organization, optionally narrowed to one location. */
  listStorageAreas(query: {
    readonly organizationId: string;
    readonly locationId?: string;
  }): Promise<readonly InventoryStorageAreaRecord[]>;
  /** Stocked items only: the posting command rejects a non-stocked policy. */
  listStockedItems(query: {
    readonly organizationId: string;
  }): Promise<readonly InventoryItemRecord[]>;
  /** Locations for an organization: the movement form's option list. */
  listLocations(query: {
    readonly organizationId: string;
  }): Promise<readonly InventoryLocationRecord[]>;
  /**
   * Bounded as-of aggregation (INV-002): the store sums the ledger per
   * `(item, location, storage_area, lot)` at `asOf`, so the caller never loads
   * the movement rows.
   */
  sumStockMovementsAsOf(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly itemId?: string;
    readonly locationId?: string;
  }): Promise<readonly StockMovementSumRecord[]>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
  /**
   * The actor's role codes, loaded from server data (never a client claim) for
   * the DEC-010 negative-override authorization check. A narrower read than
   * `AuthStore.listUserRoles`, so this slice does not depend on the auth port.
   */
  listActorRoleCodes(actorId: string): Promise<readonly string[]>;
}
