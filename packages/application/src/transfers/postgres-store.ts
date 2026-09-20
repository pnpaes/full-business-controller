import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import { createPostgresInventoryStore } from "../inventory";

import type {
  NewStockTransferRecord,
  StockTransferRecord,
  TransferMovementRecord,
  TransferStore,
  UpdateStockTransferValues,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

function toStockTransfer(row: repo.StockTransfer): StockTransferRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    fromLocationId: row.fromLocationId,
    fromStorageAreaId: row.fromStorageAreaId,
    toLocationId: row.toLocationId,
    toStorageAreaId: row.toStorageAreaId,
    status: row.status,
    dispatchedAt: row.dispatchedAt === null ? null : row.dispatchedAt.toISOString(),
    receivedAt: row.receivedAt === null ? null : row.receivedAt.toISOString(),
    dispatchMovementId: row.dispatchMovementId,
    receiptMovementId: row.receiptMovementId,
    discrepancyNote: row.discrepancyNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt === null ? null : row.updatedAt.toISOString(),
  };
}

function toTransferMovement(row: repo.StockMovement): TransferMovementRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    storageAreaId: row.storageAreaId,
    itemId: row.itemId,
    lotId: row.lotId,
    movementType: row.movementType,
    quantityDelta: row.quantityDelta,
    unitId: row.unitId,
    unitCost: row.unitCost,
    valueDelta: row.valueDelta,
    currency: row.currency,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    transferId: row.transferId,
    reversalOfId: row.reversalOfId,
    occurredAt: row.occurredAt.toISOString(),
    postedAt: row.postedAt.toISOString(),
    postedBy: row.postedBy,
    reasonCode: row.reasonCode,
    idempotencyKey: row.idempotencyKey,
  };
}

/**
 * A standard SQL string literal. Every caller passes a value from a closed
 * vocabulary, a validated UUID or an ISO instant, so there is no user text here.
 */
function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * A free-text value as a hex-encoded UTF-8 literal. The persistence repository
 * has no `updateStockTransfer` (it is committed read/create-only) and this slice
 * must not change `packages/persistence`, so the header patch goes through
 * `db.execute`, which takes **no bind parameters**. Encoding the one
 * user-supplied field (`discrepancy_note`) as hex keeps the literal to
 * `[0-9a-f]`, so no quoting/escaping question remains.
 */
function sqlFreeText(value: string): string {
  let hex = "";
  for (const byte of new TextEncoder().encode(value)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `convert_from(decode('${hex}', 'hex'), 'UTF8')`;
}

function buildHeaderUpdate(values: UpdateStockTransferValues): string {
  const sets: string[] = [];
  if (values.status !== undefined) {
    sets.push(`"status" = ${sqlText(values.status)}`);
  }
  if (values.dispatchedAt !== undefined) {
    sets.push(
      `"dispatched_at" = ${
        values.dispatchedAt === null ? "null" : `${sqlText(values.dispatchedAt)}::timestamptz`
      }`,
    );
  }
  if (values.receivedAt !== undefined) {
    sets.push(
      `"received_at" = ${
        values.receivedAt === null ? "null" : `${sqlText(values.receivedAt)}::timestamptz`
      }`,
    );
  }
  if (values.dispatchMovementId !== undefined) {
    sets.push(
      `"dispatch_movement_id" = ${
        values.dispatchMovementId === null ? "null" : `${sqlText(values.dispatchMovementId)}::uuid`
      }`,
    );
  }
  if (values.receiptMovementId !== undefined) {
    sets.push(
      `"receipt_movement_id" = ${
        values.receiptMovementId === null ? "null" : `${sqlText(values.receiptMovementId)}::uuid`
      }`,
    );
  }
  if (values.discrepancyNote !== undefined) {
    sets.push(
      `"discrepancy_note" = ${
        values.discrepancyNote === null ? "null" : sqlFreeText(values.discrepancyNote)
      }`,
    );
  }
  if (sets.length === 0) {
    throw new Error("updateStockTransfer called with an empty patch");
  }
  sets.push(`"updated_at" = now()`, `"version" = "version" + 1`);
  return sets.join(", ");
}

/**
 * Adapts the persistence repos to the `TransferStore` port. The inventory port
 * is composed in, so dispatch/receive post through the same atomic
 * `postStockMovements` batch the ledger uses.
 *
 * `createStockMovement` stamps `stock_movement.transfer_id` from the movement's
 * `source_id` whenever `source_type = 'transfer'` (they are the same id by
 * construction, `DEC-029`). The inventory posting primitive does not carry a
 * transfer id, and `stock_movement` is append-only, so the pairing column must
 * be set at INSERT; this adapter is the one place that knows the source is a
 * transfer.
 *
 * `updateStockTransfer` is the one write the committed persistence repository
 * does not expose; see `sqlFreeText` for why it runs as raw SQL.
 */
export function createPostgresTransferStore(db: Database): TransferStore {
  const inventory = createPostgresInventoryStore(db);

  return {
    ...inventory,
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresTransferStore(db));
      }
      return db.transaction((tx) => fn(createPostgresTransferStore(tx)));
    },
    createStockMovement: async (input) =>
      toTransferMovement(
        await repo.createStockMovement(db, {
          ...input,
          occurredAt: new Date(input.occurredAt),
          ...(input.sourceType === "transfer" ? { transferId: input.sourceId } : {}),
        }),
      ),
    findStockTransfer: async (query) => {
      const row = await repo.findStockTransfer(db, {
        organizationId: query.organizationId,
        transferId: query.transferId,
      });
      return row === undefined ? undefined : toStockTransfer(row);
    },
    listStockTransfers: async (query) => {
      const rows = await repo.listStockTransfers(db, {
        organizationId: query.organizationId,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.fromLocationId === undefined ? {} : { fromLocationId: query.fromLocationId }),
        ...(query.toLocationId === undefined ? {} : { toLocationId: query.toLocationId }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toStockTransfer);
    },
    createStockTransfer: async (input: NewStockTransferRecord) => {
      const row = await repo.createStockTransfer(db, {
        organizationId: input.organizationId,
        fromLocationId: input.fromLocationId,
        fromStorageAreaId: input.fromStorageAreaId,
        toLocationId: input.toLocationId,
        toStorageAreaId: input.toStorageAreaId,
        status: input.status,
        createdBy: input.createdBy,
        ...(input.id === undefined ? {} : { id: input.id }),
      });
      return toStockTransfer(row);
    },
    updateStockTransfer: async (query) => {
      const sets = buildHeaderUpdate(query.values);
      await db.execute(
        `update "stock_transfer" set ${sets} ` +
          `where "id" = ${sqlText(query.transferId)}::uuid ` +
          `and "organization_id" = ${sqlText(query.organizationId)}::uuid`,
      );
      const row = await repo.findStockTransfer(db, {
        organizationId: query.organizationId,
        transferId: query.transferId,
      });
      if (row === undefined) {
        throw new Error("stock_transfer update matched no row in the organization");
      }
      return toStockTransfer(row);
    },
    listStockMovementsByTransferId: async (query) =>
      (
        await repo.listStockMovementsByTransferId(db, {
          organizationId: query.organizationId,
          transferId: query.transferId,
        })
      ).map(toTransferMovement),
  };
}
