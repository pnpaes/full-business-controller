import type { UnitDimension } from "@aquarela/domain";
import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import { createPostgresCostingReadStore } from "../costing/read-postgres-store";

import type {
  GoodsReceiptLineRecord,
  GoodsReceiptSummaryRecord,
  ReceivingLocationRecord,
  ReceivingStore,
  ReceivingSupplierItemOption,
  ReceivingSupplierOption,
  ReceivingUnit,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/** The DB `check` constraints restrict this to `unit_dimension`. */
function toDimension(value: string): UnitDimension {
  return value as UnitDimension;
}

function toUnit(row: repo.Unit): ReceivingUnit {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    dimension: toDimension(row.dimension),
    isBase: row.isBase,
  };
}

/** `timestamptz` columns become ISO strings; `date` columns already are. */
function toGoodsReceiptSummary(row: repo.GoodsReceiptSummary): GoodsReceiptSummaryRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    supplierId: row.supplierId,
    storeName: row.storeName,
    locationId: row.locationId,
    purchaseOrderId: row.purchaseOrderId,
    deliveryRef: row.deliveryRef,
    receivedAt: row.receivedAt.toISOString(),
    status: row.status,
    acceptedBy: row.acceptedBy,
    acceptedAt: row.acceptedAt === null ? null : row.acceptedAt.toISOString(),
    reversalOfId: row.reversalOfId,
    evidenceFileId: row.evidenceFileId,
    grossTotal: row.grossTotal,
  };
}

function toGoodsReceiptLine(row: repo.GoodsReceiptLine): GoodsReceiptLineRecord {
  return {
    id: row.id,
    goodsReceiptId: row.goodsReceiptId,
    supplierItemId: row.supplierItemId,
    itemId: row.itemId,
    receivedPackQty: row.receivedPackQty,
    acceptedPackQty: row.acceptedPackQty,
    rejectedPackQty: row.rejectedPackQty,
    unitId: row.unitId,
    packToBaseFactor: row.packToBaseFactor,
    price: row.price,
    discount: row.discount,
    taxBasis: row.taxBasis,
    taxCodeId: row.taxCodeId,
    allocatedFreight: row.allocatedFreight,
    importFee: row.importFee,
    lotNumber: row.lotNumber,
    expiryDate: row.expiryDate,
    baseQtyAccepted: row.baseQtyAccepted,
    landedBaseUnitCost: row.landedBaseUnitCost,
  };
}

function toLocation(row: repo.Location): ReceivingLocationRecord {
  return { id: row.id, organizationId: row.organizationId, code: row.code, name: row.name };
}

function toSupplierOption(row: repo.Supplier): ReceivingSupplierOption {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    currency: row.currency,
  };
}

function toSupplierItemOption(row: repo.ReceivingSupplierItemOption): ReceivingSupplierItemOption {
  return {
    id: row.id,
    organizationId: row.organizationId,
    supplierId: row.supplierId,
    itemId: row.itemId,
    itemCode: row.itemCode,
    itemName: row.itemName,
    baseUnitId: row.baseUnitId,
    packUnitId: row.packUnitId,
    packUnitCode: row.packUnitCode,
    packToBaseUnitFactor: row.packToBaseUnitFactor,
  };
}

/** Adapts the persistence repositories to the `ReceivingStore` port. */
export function createPostgresReceivingStore(db: Database): ReceivingStore {
  // Reuses the costing read adapter's tax-rule projection; the receiving store
  // exposes it so `recordGoodsReceipt` can resolve an inclusive line's rate.
  const taxReads = createPostgresCostingReadStore(db);
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
        : {
            id: row.id,
            organizationId: row.organizationId,
            code: row.code,
            name: row.name,
            baseUnitId: row.baseUnitId,
          };
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
    findOpenSupplierPrice: async (supplierItemId) => {
      const row = await repo.findOpenSupplierPrice(db, supplierItemId);
      return row === undefined
        ? undefined
        : { grossPackPrice: row.grossPackPrice, landedBaseUnitCost: row.landedBaseUnitCost };
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
    listGoodsReceipts: async (query) =>
      (await repo.listGoodsReceiptSummaries(db, query)).map(toGoodsReceiptSummary),
    findGoodsReceipt: async (receiptId) => {
      const row = await repo.findGoodsReceiptSummaryById(db, receiptId);
      return row === undefined ? undefined : toGoodsReceiptSummary(row);
    },
    listGoodsReceiptLines: async (receiptId) =>
      (await repo.listGoodsReceiptLines(db, receiptId)).map(toGoodsReceiptLine),
    findLocation: async (locationId) => {
      const row = await repo.findLocationById(db, locationId);
      return row === undefined ? undefined : toLocation(row);
    },
    listLocations: async (organizationId) =>
      (await repo.listLocationsForOrganization(db, organizationId)).map(toLocation),
    listSuppliers: async (organizationId) =>
      (await repo.listSuppliersForOrganization(db, organizationId)).map(toSupplierOption),
    listSupplierItemOptions: async (organizationId) =>
      (await repo.listReceivingSupplierItemOptions(db, organizationId)).map(toSupplierItemOption),
    listTaxRules: (query) => taxReads.listTaxRules(query),
    listEffectiveTaxRules: (query) => taxReads.listEffectiveTaxRules(query),
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
