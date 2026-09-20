import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import { createPostgresInventoryStore } from "../inventory";

import type { NewWasteEventRecord, WasteEventRecord, WasteStore } from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

function toWasteEvent(row: repo.WasteEvent): WasteEventRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    storageAreaId: row.storageAreaId,
    itemId: row.itemId,
    productVariantId: row.productVariantId,
    productionBatchId: row.productionBatchId,
    quantity: row.quantity,
    unitId: row.unitId,
    stage: row.stage,
    reasonCode: row.reasonCode,
    valueMethod: row.valueMethod,
    value: row.value,
    currency: row.currency,
    occurredAt: row.occurredAt.toISOString(),
    actorId: row.actorId,
    photoFileId: row.photoFileId,
    correctiveAction: row.correctiveAction,
    snapshotId: row.snapshotId,
  };
}

function toNewWasteEvent(input: NewWasteEventRecord): repo.NewWasteEvent {
  return {
    organizationId: input.organizationId,
    locationId: input.locationId,
    storageAreaId: input.storageAreaId,
    itemId: input.itemId,
    productVariantId: input.productVariantId,
    productionBatchId: input.productionBatchId,
    quantity: input.quantity,
    unitId: input.unitId,
    stage: input.stage,
    reasonCode: input.reasonCode,
    valueMethod: input.valueMethod,
    value: input.value,
    currency: input.currency,
    occurredAt: new Date(input.occurredAt),
    actorId: input.actorId,
    photoFileId: input.photoFileId,
    correctiveAction: input.correctiveAction,
    snapshotId: input.snapshotId,
  };
}

/**
 * Adapts the persistence repositories to the `WasteStore` port: the slice-8
 * inventory adapter is composed in (so `postStockMovement`/balance locks share
 * one implementation) and only the waste-event writes/read are added.
 */
export function createPostgresWasteStore(db: Database): WasteStore {
  const inventory = createPostgresInventoryStore(db);
  return {
    ...inventory,
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresWasteStore(db));
      }
      return db.transaction((tx) => fn(createPostgresWasteStore(tx)));
    },
    findProductVariant: async (productVariantId) => {
      // No persistence reader for `product_variant` exists yet (open point (c));
      // read it through the composed drizzle instance with the relational-query
      // operator callback, so the application package gains no drizzle import.
      const row = await db.query.productVariant.findFirst({
        columns: {
          id: true,
          organizationId: true,
          code: true,
          name: true,
          finishedGoodItemId: true,
        },
        where: (fields, { eq }) => eq(fields.id, productVariantId),
      });
      return row === undefined ? undefined : { ...row };
    },
    createWasteEvent: async (input) =>
      toWasteEvent(await repo.createWasteEvent(db, toNewWasteEvent(input))),
    findWasteEvent: async (query) => {
      const row = await repo.findWasteEvent(db, query);
      return row === undefined ? undefined : toWasteEvent(row);
    },
    listWasteEvents: async (query) =>
      (
        await repo.listWasteEvents(db, {
          organizationId: query.organizationId,
          ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
          ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
          ...(query.stage === undefined ? {} : { stage: query.stage }),
          ...(query.occurredFrom === undefined ? {} : { occurredFrom: query.occurredFrom }),
          ...(query.occurredTo === undefined ? {} : { occurredTo: query.occurredTo }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.offset === undefined ? {} : { offset: query.offset }),
        })
      ).map(toWasteEvent),
  };
}
