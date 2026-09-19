import type { UnitDimension } from "@aquarela/domain";
import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type { ReceivingStore, ReceivingUnit } from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/** The DB `check` constraints restrict this to `unit_dimension`. */
function toDimension(value: string): UnitDimension {
  return value as UnitDimension;
}

function toUnit(row: repo.Unit): ReceivingUnit {
  return { id: row.id, code: row.code, dimension: toDimension(row.dimension), isBase: row.isBase };
}

/** Adapts the persistence repositories to the `ReceivingStore` port. */
export function createPostgresReceivingStore(db: Database): ReceivingStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresReceivingStore(db));
      }
      return db.transaction((tx) => fn(createPostgresReceivingStore(tx)));
    },
    findItem: async (itemId) => {
      const row = await repo.findItemById(db, itemId);
      return row === undefined
        ? undefined
        : { id: row.id, organizationId: row.organizationId, baseUnitId: row.baseUnitId };
    },
    findUnit: async (unitId) => {
      const row = await repo.findUnitById(db, unitId);
      return row === undefined ? undefined : toUnit(row);
    },
    findSupplier: async (supplierId) => {
      const row = await repo.findSupplierById(db, supplierId);
      return row === undefined ? undefined : { id: row.id, organizationId: row.organizationId };
    },
    findSupplierItem: async (supplierItemId) => {
      const row = await repo.findSupplierItemById(db, supplierItemId);
      return row === undefined
        ? undefined
        : {
            id: row.id,
            organizationId: row.organizationId,
            supplierId: row.supplierId,
            itemId: row.itemId,
            packUnitId: row.packUnitId,
            packToBaseUnitFactor: row.packToBaseUnitFactor,
          };
    },
    closeOpenSupplierPrices: (supplierItemId, at) =>
      repo.closeOpenSupplierPrices(db, supplierItemId, at),
    createSupplierPrice: async (input) => ({ id: (await repo.createSupplierPrice(db, input)).id }),
    createCostObservation: async (input) => ({
      id: (await repo.createCostObservation(db, input)).id,
    }),
    createGoodsReceipt: async (input) => ({ id: (await repo.createGoodsReceipt(db, input)).id }),
    createGoodsReceiptLine: async (input) => ({
      id: (await repo.createGoodsReceiptLine(db, input)).id,
    }),
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
