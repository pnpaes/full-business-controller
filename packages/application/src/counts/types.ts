import type { AuditInput } from "../auth";
import type { InventoryStore } from "../inventory";

/**
 * Application-level ports and DTOs for slice-9 **counts** (`INV-004`, `DEC-017`).
 *
 * `CountStore` extends `InventoryStore` so the approval command can reuse the
 * atomic `postStockMovements` batch and the as-of balance read on one port; a
 * single Postgres adapter composes `createPostgresInventoryStore` with the
 * count-specific reads/writes, and a single `FakeCountStore` composes
 * `FakeInventoryStore`, so the unit suite exercises the real posting path.
 *
 * `timestamptz` columns are carried as ISO strings (`date` columns do not occur
 * here). `scope` is persisted verbatim, never interpreted: its jsonb shape is
 * not pinned by any authority (open point — see the slice-9 report).
 */

export interface StockCountRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly locationId: string;
  /** jsonb; opaque to this slice (unshaped by any authority). */
  readonly scope: Record<string, unknown>;
  readonly blind: boolean;
  /** `timestamptz`, ISO. */
  readonly cutoff: string;
  readonly status: string;
  readonly approvedBy: string | null;
  /** `timestamptz`, ISO. */
  readonly approvedAt: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export interface StockCountLineRecord {
  readonly id: string;
  readonly stockCountId: string;
  readonly itemId: string;
  readonly storageAreaId: string;
  readonly lotId: string | null;
  /** numeric(19,6). */
  readonly expectedQty: string;
  /** numeric(19,6), null until observed. */
  readonly countedQty: string | null;
  /** numeric(19,6), null until approved (or derived by the read). */
  readonly varianceQty: string | null;
  readonly reasonCode: string | null;
  readonly recount: boolean;
}

export interface NewStockCountRecord {
  /** Optional deterministic id: a replay of an existing count is returned as-is. */
  readonly id?: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly scope: Record<string, unknown>;
  readonly blind: boolean;
  /** `timestamptz`, ISO. */
  readonly cutoff: string;
  readonly status: string;
  readonly createdBy: string | null;
}

export interface NewStockCountLineRecord {
  readonly stockCountId: string;
  readonly itemId: string;
  readonly storageAreaId: string;
  readonly lotId: string | null;
  readonly expectedQty: string;
  readonly countedQty: string | null;
  readonly varianceQty: string | null;
  readonly reasonCode: string | null;
  readonly recount: boolean;
}

/** The natural key of a count line; `lotId` null = the lot-less bucket. */
export interface StockCountLineKey {
  readonly stockCountId: string;
  readonly itemId: string;
  readonly storageAreaId: string;
  readonly lotId: string | null;
}

/**
 * A stocked item plus its running cost. `currentCost` (numeric(19,4), null when
 * never costed) is needed only by the count-variance posting rule; the inventory
 * slice's `InventoryItemRecord` deliberately does not carry it, so the counts
 * port reads the full item row itself.
 */
export interface CountItemRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly baseUnitId: string;
  readonly inventoryPolicy: string;
  readonly currentCost: string | null;
}

export interface ListStockCountsQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface UpdateStockCountValues {
  readonly status?: string;
  readonly approvedBy?: string | null;
  /** ISO instant. */
  readonly approvedAt?: string | null;
}

export interface UpdateStockCountLineValues {
  /** numeric(19,6). */
  readonly countedQty?: string | null;
  /** numeric(19,6). */
  readonly varianceQty?: string | null;
  readonly reasonCode?: string | null;
  readonly recount?: boolean;
}

export interface CountStore extends InventoryStore {
  /** Binds `fn` to one transaction so the count writes and the ledger post commit together. */
  withTransaction<T>(fn: (store: CountStore) => Promise<T>): Promise<T>;
  /** One count by id, organization-scoped (`DEC-061`), or `undefined`. */
  findStockCount(query: {
    readonly organizationId: string;
    readonly stockCountId: string;
  }): Promise<StockCountRecord | undefined>;
  listStockCounts(query: ListStockCountsQuery): Promise<readonly StockCountRecord[]>;
  createStockCount(input: NewStockCountRecord): Promise<StockCountRecord>;
  updateStockCount(id: string, values: UpdateStockCountValues): Promise<StockCountRecord>;
  listStockCountLines(query: {
    readonly organizationId: string;
    readonly stockCountId: string;
  }): Promise<readonly StockCountLineRecord[]>;
  /** One line by its natural key, organization-scoped through the parent count. */
  findStockCountLine(
    query: StockCountLineKey & { readonly organizationId: string },
  ): Promise<StockCountLineRecord | undefined>;
  createStockCountLine(input: NewStockCountLineRecord): Promise<StockCountLineRecord>;
  /** Create-or-find by natural key, race-safe (the count-line idempotency path). */
  findOrCreateStockCountLine(input: NewStockCountLineRecord): Promise<StockCountLineRecord>;
  updateStockCountLine(
    id: string,
    values: UpdateStockCountLineValues,
  ): Promise<StockCountLineRecord>;
  findCountItem(itemId: string): Promise<CountItemRecord | undefined>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
