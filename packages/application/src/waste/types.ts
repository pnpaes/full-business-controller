import type { InventoryStore } from "../inventory";

/**
 * Application-level ports and DTOs for slice-9 waste (`WASTE-001`/`002`,
 * `DEC-018`). The port extends the slice-8 `InventoryStore` so `recordWasteEvent`
 * posts its negative `waste` movement through the same `postStockMovement`
 * command (one ledger writer, ADR-0005) and joins the same transaction.
 *
 * `timestamptz` columns are carried as ISO strings and `date` columns as
 * `yyyy-mm-dd` strings, like the inventory port.
 */

/** A produced product variant; the movement target is its finished-good item. */
export interface WasteProductVariantRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly finishedGoodItemId: string | null;
}

/**
 * One `waste_event` row. `valueMethod` is captured on the event while the linked
 * ledger movement is valued by the moving weighted average (ADR-0005); the two
 * can contradict (open point (a), reported not resolved).
 */
export interface WasteEventRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly itemId: string | null;
  readonly productVariantId: string | null;
  /**
   * Deferred plain uuid: no production-batch table yet (open point (c)). Per
   * `WASTE-002`, a waste linked to a production batch must not be counted again
   * as recipe yield loss; with no batch slice yet the link is stored but not
   * enforced (recorded, not resolved).
   */
  readonly productionBatchId: string | null;
  /** numeric(19,6). */
  readonly quantity: string;
  readonly unitId: string;
  readonly stage: string;
  readonly reasonCode: string;
  readonly valueMethod: string;
  /** numeric(19,4); nullable until a value is recorded. */
  readonly value: string | null;
  readonly currency: string | null;
  /** ISO timestamp. */
  readonly occurredAt: string;
  readonly actorId: string;
  /** Deferred plain uuid: no file-object table yet (open point (c)). */
  readonly photoFileId: string | null;
  readonly correctiveAction: string | null;
  /** Deferred plain uuid: snapshot semantics undecided (open point (c)). */
  readonly snapshotId: string | null;
}

export interface NewWasteEventRecord {
  readonly organizationId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly itemId: string | null;
  readonly productVariantId: string | null;
  readonly productionBatchId: string | null;
  /** numeric(19,6), positive. */
  readonly quantity: string;
  readonly unitId: string;
  readonly stage: string;
  readonly reasonCode: string;
  readonly valueMethod: string;
  /** numeric(19,4). */
  readonly value: string | null;
  readonly currency: string | null;
  /** ISO timestamp. */
  readonly occurredAt: string;
  readonly actorId: string;
  readonly photoFileId: string | null;
  readonly correctiveAction: string | null;
  readonly snapshotId: string | null;
}

/** Waste-list filters for the read API. */
export interface WasteEventListQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly itemId?: string;
  readonly stage?: string;
  readonly occurredFrom?: Date;
  readonly occurredTo?: Date;
  readonly limit?: number;
  readonly offset?: number;
}

export interface WasteStore extends InventoryStore {
  /**
   * Binds `fn` to one transaction and hands it a full `WasteStore`, so the
   * waste-event insert and the ledger posting commit or roll back together.
   */
  withTransaction<T>(fn: (store: WasteStore) => Promise<T>): Promise<T>;
  /**
   * A product variant, organization-checked by the caller. No persistence
   * reader exists yet, so the adapter reads `product_variant` directly (open
   * point (c): replace with a repository function when one lands).
   */
  findProductVariant(productVariantId: string): Promise<WasteProductVariantRecord | undefined>;
  createWasteEvent(input: NewWasteEventRecord): Promise<WasteEventRecord>;
  findWasteEvent(query: {
    readonly organizationId: string;
    readonly wasteEventId: string;
  }): Promise<WasteEventRecord | undefined>;
  listWasteEvents(query: WasteEventListQuery): Promise<readonly WasteEventRecord[]>;
}
