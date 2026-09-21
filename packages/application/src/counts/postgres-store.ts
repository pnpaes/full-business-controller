import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import { createPostgresDataQualityException } from "../data-quality";
import { createPostgresInventoryStore } from "../inventory";

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

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

function toScope(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toStockCount(row: repo.StockCount): StockCountRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    scope: toScope(row.scope),
    blind: row.blind,
    cutoff: row.cutoff.toISOString(),
    status: row.status,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt === null ? null : row.approvedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

function toStockCountLine(row: repo.StockCountLine): StockCountLineRecord {
  return {
    id: row.id,
    stockCountId: row.stockCountId,
    itemId: row.itemId,
    storageAreaId: row.storageAreaId,
    lotId: row.lotId,
    expectedQty: row.expectedQty,
    countedQty: row.countedQty,
    varianceQty: row.varianceQty,
    reasonCode: row.reasonCode,
    recount: row.recount,
  };
}

function toCountItem(row: repo.Item): CountItemRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    baseUnitId: row.baseUnitId,
    inventoryPolicy: row.inventoryPolicy,
    currentCost: row.currentCost,
  };
}

function newLineValues(input: NewStockCountLineRecord): repo.NewStockCountLine {
  return {
    stockCountId: input.stockCountId,
    itemId: input.itemId,
    storageAreaId: input.storageAreaId,
    lotId: input.lotId,
    expectedQty: input.expectedQty,
    countedQty: input.countedQty,
    varianceQty: input.varianceQty,
    reasonCode: input.reasonCode,
    recount: input.recount,
  };
}

/**
 * Adapts the persistence repos to the `CountStore` port. The inventory port is
 * composed in, so the approval path posts through the same atomic
 * `postStockMovements` the ledger uses and reads balances through the same
 * `sumStockMovementsAsOf`.
 *
 * `withTransaction` re-wraps with a `CountStore`, so a command that opens a
 * transaction gets count methods inside it (the inventory port alone would not
 * provide them).
 *
 * The persistence `counts.ts` repository is read/create only (no update
 * functions), and this slice must not change `packages/persistence`, so the two
 * narrow updates a count lifecycle needs — the header status/approval and a
 * line's counted/variance values — are written here through the exported Drizzle
 * schema. Reads and creates still go through the repository.
 */
export function createPostgresCountStore(db: Database): CountStore {
  const inventory = createPostgresInventoryStore(db);

  return {
    ...inventory,
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresCountStore(db));
      }
      return db.transaction((tx) => fn(createPostgresCountStore(tx)));
    },
    findStockCount: async (query) => {
      const row = await repo.findStockCount(db, {
        organizationId: query.organizationId,
        stockCountId: query.stockCountId,
      });
      return row === undefined ? undefined : toStockCount(row);
    },
    listStockCounts: async (query) => {
      const rows = await repo.listStockCounts(db, {
        organizationId: query.organizationId,
        ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toStockCount);
    },
    createStockCount: async (input: NewStockCountRecord) => {
      const row = await repo.createStockCount(db, {
        organizationId: input.organizationId,
        locationId: input.locationId,
        scope: input.scope,
        blind: input.blind,
        cutoff: new Date(input.cutoff),
        status: input.status,
        createdBy: input.createdBy,
        ...(input.id === undefined ? {} : { id: input.id }),
      });
      return toStockCount(row);
    },
    updateStockCount: async (id, values: UpdateStockCountValues) => {
      const patch: repo.StockCountPatch = { updatedAt: new Date() };
      if (values.status !== undefined) {
        patch.status = values.status;
      }
      if (values.approvedBy !== undefined) {
        patch.approvedBy = values.approvedBy;
      }
      if (values.approvedAt !== undefined) {
        patch.approvedAt = values.approvedAt === null ? null : new Date(values.approvedAt);
      }
      const row = await repo.updateStockCount(db, id, patch);
      if (row === undefined) {
        throw new Error("stock_count not found for update");
      }
      return toStockCount(row);
    },
    listStockCountLines: async (query) =>
      (
        await repo.listStockCountLines(db, {
          organizationId: query.organizationId,
          stockCountId: query.stockCountId,
        })
      ).map(toStockCountLine),
    findStockCountLine: async (query: StockCountLineKey & { readonly organizationId: string }) => {
      const row = await repo.findStockCountLine(db, query);
      return row === undefined ? undefined : toStockCountLine(row);
    },
    createStockCountLine: async (input) =>
      toStockCountLine(await repo.createStockCountLine(db, newLineValues(input))),
    findOrCreateStockCountLine: async (input) =>
      toStockCountLine(await repo.findOrCreateStockCountLine(db, newLineValues(input))),
    updateStockCountLine: async (id, values: UpdateStockCountLineValues) => {
      const patch: repo.StockCountLinePatch = {};
      if (values.countedQty !== undefined) {
        patch.countedQty = values.countedQty;
      }
      if (values.varianceQty !== undefined) {
        patch.varianceQty = values.varianceQty;
      }
      if (values.reasonCode !== undefined) {
        patch.reasonCode = values.reasonCode;
      }
      if (values.recount !== undefined) {
        patch.recount = values.recount;
      }
      const row = await repo.updateStockCountLine(db, id, patch);
      if (row === undefined) {
        throw new Error("stock_count_line not found for update");
      }
      return toStockCountLine(row);
    },
    findCountItem: async (itemId) => {
      const row = await repo.findItemById(db, itemId);
      return row === undefined ? undefined : toCountItem(row);
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
    createDataQualityException: (input) => createPostgresDataQualityException(db, input),
  };
}
