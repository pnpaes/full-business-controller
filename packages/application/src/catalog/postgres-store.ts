import { DomainError, type UnitDimension } from "@aquarela/domain";
import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  CatalogItemRecord,
  ConversionEdge,
  MasterDataStore,
  MasterItem,
  MasterSupplierRecord,
  MasterUnit,
  SupplierItemDetail,
  SupplierItemRecord,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

const SUPPLIER_SKU_CONSTRAINT = "supplier_item_supplier_id_supplier_sku_key";
const SUPPLIER_SKU_CONFLICT_MESSAGE = "supplier SKU already registered for this supplier";

const UNIT_CONVERSION_CONFLICT_MESSAGE =
  "a conversion for this unit pair is already effective for this scope";

/** SQLSTATE `23P01` is an exclusion-constraint violation (overlapping window). */
const EXCLUSION_VIOLATION = "23P01";
/** SQLSTATE `23505` is a unique-constraint violation (same version tuple). */
const UNIQUE_VIOLATION = "23505";

/**
 * Translates a `unit_conversion` overlap (`23P01`, the gist exclusion
 * constraints) or version-tuple collision (`23505`) into the command's domain
 * failure, so a concurrent insert never leaks a raw driver error.
 */
function isUnitConversionConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const { code } = error as { code?: string };
  return code === EXCLUSION_VIOLATION || code === UNIQUE_VIOLATION;
}

/**
 * Translates the `supplier_item` unique-constraint violation (SQLSTATE 23505)
 * into the command's domain failure instead of leaking a raw driver error.
 */
function isSupplierSkuConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const { code, constraint } = error as { code?: string; constraint?: string };
  return code === "23505" && (constraint === undefined || constraint === SUPPLIER_SKU_CONSTRAINT);
}

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

function toMasterUnit(row: repo.Unit): MasterUnit {
  return {
    id: row.id,
    code: row.code,
    dimension: toDimension(row.dimension),
    isBase: row.isBase,
  };
}

function toMasterItem(row: repo.Item): MasterItem {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    sku: row.sku,
    baseUnitId: row.baseUnitId,
  };
}

function toCatalogItem(row: repo.ItemWithUnit): CatalogItemRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    sku: row.sku,
    name: row.name,
    itemType: row.itemType,
    baseUnitId: row.baseUnitId,
    baseUnitCode: row.baseUnitCode,
    inventoryPolicy: row.inventoryPolicy,
    lotTracked: row.lotTracked,
    currentCost: row.currentCost,
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
  };
}

function toSupplierItemDetail(row: repo.SupplierItemWithRefs): SupplierItemDetail {
  return {
    id: row.id,
    organizationId: row.organizationId,
    supplierId: row.supplierId,
    supplierCode: row.supplierCode,
    supplierName: row.supplierName,
    itemId: row.itemId,
    supplierSku: row.supplierSku,
    packUnitId: row.packUnitId,
    packUnitCode: row.packUnitCode,
    packToBaseUnitFactor: row.packToBaseUnitFactor,
    minOrderQty: row.minOrderQty,
    leadTimeDays: row.leadTimeDays,
    preferred: row.preferred,
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

function toSupplierRecord(row: repo.Supplier): MasterSupplierRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    contact: row.contact,
    terms: row.terms,
    currency: row.currency,
    active: row.active,
  };
}

/** Adapts the persistence repositories to the `MasterDataStore` port. */
export function createPostgresMasterDataStore(db: Database): MasterDataStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresMasterDataStore(db));
      }
      return db.transaction((tx) => fn(createPostgresMasterDataStore(tx)));
    },
    findUnit: async (unitId) => {
      const row = await repo.findUnitById(db, unitId);
      return row === undefined ? undefined : toMasterUnit(row);
    },
    findUnitByCode: async (organizationId, code) => {
      const row = await repo.findUnitByCode(db, organizationId, code);
      return row === undefined ? undefined : toMasterUnit(row);
    },
    createUnit: async (input) => {
      const row = await repo.createUnit(db, {
        organizationId: input.organizationId,
        code: input.code,
        dimension: input.dimension,
        isBase: input.isBase ?? false,
      });
      return toMasterUnit(row);
    },
    listUnits: async (query) => (await repo.listUnits(db, query)).map(toMasterUnit),
    findItem: async (itemId) => {
      const row = await repo.findItemById(db, itemId);
      return row === undefined ? undefined : toMasterItem(row);
    },
    findItemByCode: async (organizationId, code) => {
      const row = await repo.findItemByCode(db, organizationId, code);
      return row === undefined ? undefined : toMasterItem(row);
    },
    findItemBySku: async (organizationId, sku) => {
      const row = await repo.findItemBySku(db, organizationId, sku);
      return row === undefined ? undefined : toMasterItem(row);
    },
    createItem: async (input) => toMasterItem(await repo.createItem(db, input)),
    listItems: async (query) => {
      const page = await repo.listItems(db, query);
      return { items: page.rows.map(toCatalogItem), total: page.total };
    },
    findCatalogItem: async (itemId) => {
      const row = await repo.findItemWithUnitById(db, itemId);
      return row === undefined ? undefined : toCatalogItem(row);
    },
    listSupplierItemsForItem: async (organizationId, itemId) =>
      (await repo.listSupplierItemsForItem(db, organizationId, itemId)).map(toSupplierItemDetail),
    findOrganization: async (organizationId) => {
      const row = await repo.findOrganizationById(db, organizationId);
      return row === undefined ? undefined : { id: row.id, currency: row.currency };
    },
    findSupplier: async (supplierId) => {
      const row = await repo.findSupplierById(db, supplierId);
      return row === undefined ? undefined : { id: row.id, organizationId: row.organizationId };
    },
    findSupplierItemBySku: async (supplierId, supplierSku) => {
      const row = await repo.findSupplierItemBySku(db, supplierId, supplierSku);
      return row === undefined ? undefined : toSupplierItem(row);
    },
    createSupplierItem: async (input) => {
      try {
        return toSupplierItem(await repo.createSupplierItem(db, input));
      } catch (error) {
        if (isSupplierSkuConflict(error)) {
          throw new DomainError(SUPPLIER_SKU_CONFLICT_MESSAGE);
        }
        throw error;
      }
    },
    updateItem: async (input) => {
      const existing = await repo.findItemWithUnitById(db, input.itemId);
      if (existing === undefined) {
        return;
      }
      const changes: { name?: string; inventoryPolicy?: string; lotTracked?: boolean } = {};
      if (input.name !== undefined) {
        changes.name = input.name;
      }
      if (input.inventoryPolicy !== undefined) {
        changes.inventoryPolicy = input.inventoryPolicy;
      }
      if (input.lotTracked !== undefined) {
        changes.lotTracked = input.lotTracked;
      }
      // ponytail: the persistence layer is frozen this wave, so the update is
      // expressed as an id-targeted upsert through the exported table rather
      // than a repository `updateItem`. All not-null columns are supplied from
      // the read; the `set` applies only the mutable fields. Promote this to a
      // real repository update when persistence is editable again.
      await db
        .insert(repo.item)
        .values({
          id: existing.id,
          organizationId: existing.organizationId,
          code: existing.code,
          sku: existing.sku,
          name: existing.name,
          itemType: existing.itemType,
          baseUnitId: existing.baseUnitId,
          inventoryPolicy: existing.inventoryPolicy,
          lotTracked: existing.lotTracked,
          activeFrom: existing.activeFrom,
        })
        .onConflictDoUpdate({ target: repo.item.id, set: changes })
        .returning();
    },
    findSupplierByCode: async (organizationId, code) => {
      const row = await repo.findSupplierByCode(db, organizationId, code);
      return row === undefined ? undefined : toSupplierRecord(row);
    },
    createSupplier: async (input) =>
      toSupplierRecord(
        await repo.createSupplier(db, {
          organizationId: input.organizationId,
          code: input.code,
          name: input.name,
          contact: input.contact ?? null,
          terms: input.terms ?? null,
          currency: input.currency,
          active: input.active ?? true,
        }),
      ),
    createUnitConversion: async (input) => {
      try {
        const row = await repo.createUnitConversion(db, input);
        return { id: row.id };
      } catch (error) {
        if (isUnitConversionConflict(error)) {
          throw new DomainError(UNIT_CONVERSION_CONFLICT_MESSAGE);
        }
        throw error;
      }
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
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
