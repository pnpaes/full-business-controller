import { randomUUID } from "node:crypto";

import {
  createFakeDataQualityException,
  type DataQualityExceptionRecord,
  type NewDataQualityExceptionRecord,
} from "../data-quality";
import type { NewStockMovementRecord } from "../inventory";
import {
  FakeInventoryStore,
  seedInventoryFixture,
  type InventoryFixture,
} from "../inventory/test-support";

import type {
  ListStockTransfersQuery,
  NewStockTransferRecord,
  StockTransferRecord,
  TransferMovementRecord,
  TransferStore,
  UpdateStockTransferValues,
} from "./types";

/**
 * In-memory `TransferStore` for the unit suite. It composes `FakeInventoryStore`,
 * so the dispatch/receive commands run the real `postStockMovements` path against
 * the same fake ledger; `transfers.postgres.test.ts` covers the real adapter.
 *
 * `createStockMovement` mirrors the Postgres adapter's transfer-id stamping: a
 * movement whose `source_type` is `transfer` is paired by `transfer_id` with the
 * transfer header (`DEC-029`), because the inventory posting primitive does not
 * carry the id and the ledger is append-only.
 */
export class FakeTransferStore extends FakeInventoryStore implements TransferStore {
  readonly stockTransfers = new Map<string, StockTransferRecord>();
  /** `DEC-080` data-quality exceptions, in insertion order. */
  readonly dataQualityExceptions = new Map<string, DataQualityExceptionRecord>();

  override async withTransaction<T>(fn: (store: TransferStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  override async createStockMovement(
    input: NewStockMovementRecord,
  ): Promise<TransferMovementRecord> {
    const record = await super.createStockMovement(input);
    const withTransfer: TransferMovementRecord = {
      ...record,
      transferId: input.sourceType === "transfer" ? input.sourceId : null,
    };
    this.stockMovements.set(record.id, withTransfer);
    return withTransfer;
  }

  findStockTransfer(query: {
    readonly organizationId: string;
    readonly transferId: string;
  }): Promise<StockTransferRecord | undefined> {
    const transfer = this.stockTransfers.get(query.transferId);
    return Promise.resolve(
      transfer !== undefined && transfer.organizationId === query.organizationId
        ? transfer
        : undefined,
    );
  }

  listStockTransfers(query: ListStockTransfersQuery): Promise<readonly StockTransferRecord[]> {
    const rows = [...this.stockTransfers.values()]
      .filter((transfer) => transfer.organizationId === query.organizationId)
      .filter((transfer) => query.status === undefined || transfer.status === query.status)
      .filter(
        (transfer) =>
          query.fromLocationId === undefined || transfer.fromLocationId === query.fromLocationId,
      )
      .filter(
        (transfer) =>
          query.toLocationId === undefined || transfer.toLocationId === query.toLocationId,
      )
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return Promise.resolve(rows.slice(offset, offset + limit));
  }

  createStockTransfer(input: NewStockTransferRecord): Promise<StockTransferRecord> {
    const now = new Date().toISOString();
    const record: StockTransferRecord = {
      id: input.id ?? randomUUID(),
      organizationId: input.organizationId,
      fromLocationId: input.fromLocationId,
      fromStorageAreaId: input.fromStorageAreaId,
      toLocationId: input.toLocationId,
      toStorageAreaId: input.toStorageAreaId,
      status: input.status,
      dispatchedAt: null,
      receivedAt: null,
      dispatchMovementId: null,
      receiptMovementId: null,
      discrepancyNote: null,
      createdAt: now,
      updatedAt: null,
    };
    this.stockTransfers.set(record.id, record);
    return Promise.resolve(record);
  }

  updateStockTransfer(query: {
    readonly organizationId: string;
    readonly transferId: string;
    readonly values: UpdateStockTransferValues;
  }): Promise<StockTransferRecord> {
    const existing = this.stockTransfers.get(query.transferId);
    if (existing === undefined || existing.organizationId !== query.organizationId) {
      throw new Error("stock_transfer not found for update");
    }
    const updated: StockTransferRecord = {
      ...existing,
      ...query.values,
      updatedAt: new Date().toISOString(),
    };
    this.stockTransfers.set(query.transferId, updated);
    return Promise.resolve(updated);
  }

  createDataQualityException(
    input: NewDataQualityExceptionRecord,
  ): Promise<DataQualityExceptionRecord> {
    return createFakeDataQualityException(this.dataQualityExceptions, input);
  }

  listStockMovementsByTransferId(query: {
    readonly organizationId: string;
    readonly transferId: string;
  }): Promise<readonly TransferMovementRecord[]> {
    const ledgerOrder = (a: TransferMovementRecord, b: TransferMovementRecord): number => {
      if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
      if (a.postedAt !== b.postedAt) return a.postedAt < b.postedAt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    };
    return Promise.resolve(
      [...this.stockMovements.values()]
        .filter((movement) => movement.organizationId === query.organizationId)
        .filter(
          (movement): movement is TransferMovementRecord =>
            (movement as TransferMovementRecord).transferId === query.transferId,
        )
        .sort(ledgerOrder),
    );
  }
}

export interface TransferFixture extends InventoryFixture {
  /** A physical storage area at `otherLocationId` (the transfer destination). */
  readonly toStorageAreaId: string;
  /** The `is_transit` storage area at `transitLocationId`. */
  readonly transitStorageAreaId: string;
}

/**
 * Seeds the transfer fixture on top of the inventory one: the destination
 * storage area, the organization's in-transit storage area, and an opening
 * balance at the source so a dispatch has stock to move.
 */
export async function seedTransferFixture(store: FakeTransferStore): Promise<TransferFixture> {
  const base = seedInventoryFixture(store);
  const toStorageAreaId = "area-to";
  const transitStorageAreaId = "area-transit";

  store.storageAreas.set(transitStorageAreaId, {
    id: transitStorageAreaId,
    organizationId: base.organizationId,
    locationId: base.transitLocationId,
    code: "TRANSIT",
    name: "In transit",
    kind: "transit",
    isTransit: true,
  });
  store.storageAreas.set(toStorageAreaId, {
    id: toStorageAreaId,
    organizationId: base.organizationId,
    locationId: base.otherLocationId,
    code: "DRY2",
    name: "Dry store 2",
    kind: "dry_store",
    isTransit: false,
  });

  const at = new Date("2026-09-01T08:00:00.000Z");
  const key = {
    organizationId: base.organizationId,
    itemId: base.itemId,
    locationId: base.locationId,
    storageAreaId: base.storageAreaId,
    lotId: null,
  };
  await store.lockStockBalance(key, at);
  await store.saveStockBalance(key, {
    quantityOnHand: "100.000000",
    valueOnHand: "25.0000",
    avgUnitCost: "0.2500",
    asOf: at,
  });

  return { ...base, toStorageAreaId, transitStorageAreaId };
}
