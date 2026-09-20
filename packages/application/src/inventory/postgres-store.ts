import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  InventoryItemRecord,
  InventoryLocationRecord,
  InventoryOrganizationRecord,
  InventoryStorageAreaRecord,
  InventoryStore,
  InventoryUnitRecord,
  StockBalanceRecord,
  StockLotRecord,
  StockMovementRecord,
  StockMovementSumRecord,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

function toOrganization(row: repo.Organization): InventoryOrganizationRecord {
  return { id: row.id, currency: row.currency };
}

function toItem(row: repo.Item): InventoryItemRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    baseUnitId: row.baseUnitId,
    inventoryPolicy: row.inventoryPolicy,
    lotTracked: row.lotTracked,
  };
}

function toLocation(row: repo.Location): InventoryLocationRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    kind: row.kind,
  };
}

function toStorageArea(row: repo.StorageArea): InventoryStorageAreaRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    code: row.code,
    name: row.name,
    kind: row.kind,
    isTransit: row.isTransit,
  };
}

function toUnit(row: repo.Unit): InventoryUnitRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    dimension: row.dimension,
  };
}

/** `date` columns stay `yyyy-mm-dd`; only `received_at` is `timestamptz`. */
function toStockLot(row: repo.StockLot): StockLotRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    itemId: row.itemId,
    locationId: row.locationId,
    lotNumber: row.lotNumber,
    expiryDate: row.expiryDate,
    openedDate: row.openedDate,
    receivedAt: row.receivedAt === null ? null : row.receivedAt.toISOString(),
    sourceMovementId: row.sourceMovementId,
  };
}

function toStockMovement(row: repo.StockMovement): StockMovementRecord {
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
    reversalOfId: row.reversalOfId,
    occurredAt: row.occurredAt.toISOString(),
    postedAt: row.postedAt.toISOString(),
    postedBy: row.postedBy,
    reasonCode: row.reasonCode,
    idempotencyKey: row.idempotencyKey,
  };
}

function toStockBalance(row: repo.StockBalance): StockBalanceRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    itemId: row.itemId,
    locationId: row.locationId,
    storageAreaId: row.storageAreaId,
    lotId: row.lotId,
    quantityOnHand: row.quantityOnHand,
    valueOnHand: row.valueOnHand,
    avgUnitCost: row.avgUnitCost,
    asOf: row.asOf.toISOString(),
  };
}

function toStockMovementSum(row: repo.StockMovementSum): StockMovementSumRecord {
  return {
    organizationId: row.organizationId,
    itemId: row.itemId,
    locationId: row.locationId,
    storageAreaId: row.storageAreaId,
    lotId: row.lotId,
    quantityOnHand: row.quantityOnHand,
    valueOnHand: row.valueOnHand,
  };
}

/** Adapts the persistence repositories to the `InventoryStore` port. */
export function createPostgresInventoryStore(db: Database): InventoryStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresInventoryStore(db));
      }
      return db.transaction((tx) => fn(createPostgresInventoryStore(tx)));
    },
    findOrganization: async (organizationId) => {
      const row = await repo.findOrganizationById(db, organizationId);
      return row === undefined ? undefined : toOrganization(row);
    },
    findItem: async (itemId) => {
      const row = await repo.findItemById(db, itemId);
      return row === undefined ? undefined : toItem(row);
    },
    findLocation: async (locationId) => {
      const row = await repo.findLocationById(db, locationId);
      return row === undefined ? undefined : toLocation(row);
    },
    findStorageArea: async (storageAreaId) => {
      const row = await repo.findStorageArea(db, storageAreaId);
      return row === undefined ? undefined : toStorageArea(row);
    },
    findStorageAreaByCode: async (query) => {
      const row = await repo.findStorageAreaByCode(db, query);
      return row === undefined ? undefined : toStorageArea(row);
    },
    createStorageArea: async (input) => toStorageArea(await repo.createStorageArea(db, input)),
    findUnit: async (unitId) => {
      const row = await repo.findUnitById(db, unitId);
      return row === undefined ? undefined : toUnit(row);
    },
    findStockLot: async (lotId) => {
      const row = await repo.findStockLot(db, lotId);
      return row === undefined ? undefined : toStockLot(row);
    },
    findOrCreateStockLot: async (input) =>
      toStockLot(
        await repo.findOrCreateStockLot(db, {
          ...input,
          receivedAt: input.receivedAt === null ? null : new Date(input.receivedAt),
        }),
      ),
    findStockMovement: async (id) => {
      const row = await repo.findStockMovement(db, id);
      return row === undefined ? undefined : toStockMovement(row);
    },
    findStockMovementByIdempotencyKey: async (organizationId, key) => {
      const row = await repo.findStockMovementByIdempotencyKey(db, organizationId, key);
      return row === undefined ? undefined : toStockMovement(row);
    },
    findStockMovementReversal: async (movementId) => {
      const row = await repo.findStockMovementReversal(db, movementId);
      return row === undefined ? undefined : toStockMovement(row);
    },
    lockStockBalance: async (key, at) =>
      toStockBalance(await repo.lockOrCreateStockBalance(db, key, at)),
    findStockBalance: async (key) => {
      const row = await repo.findStockBalance(db, key);
      return row === undefined ? undefined : toStockBalance(row);
    },
    saveStockBalance: async (key, values) =>
      toStockBalance(await repo.saveStockBalance(db, key, values)),
    createStockMovement: async (input) =>
      toStockMovement(
        await repo.createStockMovement(db, { ...input, occurredAt: new Date(input.occurredAt) }),
      ),
    listStockMovements: async (query) =>
      (
        await repo.listStockMovements(db, {
          organizationId: query.organizationId,
          ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
          ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
          ...(query.storageAreaId === undefined ? {} : { storageAreaId: query.storageAreaId }),
          ...(query.lotId === undefined ? {} : { lotId: query.lotId }),
          ...(query.occurredFrom === undefined ? {} : { occurredFrom: query.occurredFrom }),
          ...(query.occurredTo === undefined ? {} : { asOf: query.occurredTo }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.offset === undefined ? {} : { offset: query.offset }),
        })
      ).map(toStockMovement),
    listStorageAreas: async (query) => (await repo.listStorageAreas(db, query)).map(toStorageArea),
    listStockedItems: async (query) => (await repo.listStockedItems(db, query)).map(toItem),
    listLocations: async (query) => (await repo.listLocations(db, query)).map(toLocation),
    sumStockMovementsAsOf: async (query) =>
      (await repo.sumStockMovementsAsOf(db, query)).map(toStockMovementSum),
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
    listActorRoleCodes: async (actorId) =>
      (await repo.listUserRoles(db, actorId)).map((row) => row.code),
  };
}
