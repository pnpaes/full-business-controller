import type { UnitDimension } from "@aquarela/domain";
import * as repo from "@aquarela/persistence";
import type { Database } from "@aquarela/persistence";

import type { ConversionEdge, MasterDataStore, MasterUnit, SupplierItemRecord } from "./types";

/** The DB `check` constraints restrict these to `unit_dimension`. */
function toDimension(value: string): UnitDimension {
  return value as UnitDimension;
}

function toUnit(row: repo.EffectiveConversion, side: "from" | "to"): MasterUnit {
  return side === "from"
    ? {
        id: row.fromUnitId,
        code: row.fromUnitCode,
        dimension: toDimension(row.fromUnitDimension),
        isBase: row.fromUnitIsBase,
      }
    : {
        id: row.toUnitId,
        code: row.toUnitCode,
        dimension: toDimension(row.toUnitDimension),
        isBase: row.toUnitIsBase,
      };
}

function toSupplierItem(row: repo.SupplierItem): SupplierItemRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    supplierId: row.supplierId,
    itemId: row.itemId,
    supplierSku: row.supplierSku,
    packUnitId: row.packUnitId,
    packToBaseUnitFactor: row.packToBaseUnitFactor,
    minOrderQty: row.minOrderQty,
    leadTimeDays: row.leadTimeDays,
    preferred: row.preferred,
  };
}

/** Adapts the persistence repositories to the `MasterDataStore` port. */
export function createPostgresMasterDataStore(db: Database): MasterDataStore {
  return {
    findUnit: async (unitId) => {
      const row = await repo.findUnitById(db, unitId);
      return row === undefined
        ? undefined
        : {
            id: row.id,
            code: row.code,
            dimension: toDimension(row.dimension),
            isBase: row.isBase,
          };
    },
    findItem: async (itemId) => {
      const row = await repo.findItemById(db, itemId);
      return row === undefined
        ? undefined
        : { id: row.id, organizationId: row.organizationId, baseUnitId: row.baseUnitId };
    },
    findSupplier: async (supplierId) => {
      const row = await repo.findSupplierById(db, supplierId);
      return row === undefined ? undefined : { id: row.id, organizationId: row.organizationId };
    },
    findSupplierItemBySku: async (supplierId, supplierSku) => {
      const row = await repo.findSupplierItemBySku(db, supplierId, supplierSku);
      return row === undefined ? undefined : toSupplierItem(row);
    },
    createSupplierItem: async (input) => toSupplierItem(await repo.createSupplierItem(db, input)),
    listEffectiveConversions: async (
      organizationId: string,
      asOf: Date,
      itemId: string | null,
    ): Promise<readonly ConversionEdge[]> => {
      const rows = await repo.listEffectiveConversions(db, { organizationId, asOf, itemId });
      return rows.map((row) => ({
        fromUnit: toUnit(row, "from"),
        toUnit: toUnit(row, "to"),
        factor: row.factor,
        itemId: row.itemId,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
      }));
    },
  };
}
