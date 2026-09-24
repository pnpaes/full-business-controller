import { and, asc, eq, gt, ilike, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "../client";
import {
  costCenter,
  item,
  productVariant,
  supplier,
  supplierItem,
  unit,
  unitConversion,
} from "../schema";

export type Item = typeof item.$inferSelect;
export type NewItem = typeof item.$inferInsert;
export type Unit = typeof unit.$inferSelect;
export type NewUnit = typeof unit.$inferInsert;
export type Supplier = typeof supplier.$inferSelect;
export type NewSupplier = typeof supplier.$inferInsert;
export type SupplierItem = typeof supplierItem.$inferSelect;
export type NewSupplierItem = typeof supplierItem.$inferInsert;
export type UnitConversion = typeof unitConversion.$inferSelect;
export type NewUnitConversion = typeof unitConversion.$inferInsert;
export type CostCenter = typeof costCenter.$inferSelect;
export type NewCostCenter = typeof costCenter.$inferInsert;

export async function createItem(db: Database, input: NewItem): Promise<Item> {
  const rows = await db.insert(item).values(input).returning();
  return rows[0]!;
}

export async function findItemById(db: Database, itemId: string): Promise<Item | undefined> {
  const rows = await db.select().from(item).where(eq(item.id, itemId)).limit(1);
  return rows[0];
}

export async function findUnitById(db: Database, unitId: string): Promise<Unit | undefined> {
  const rows = await db.select().from(unit).where(eq(unit.id, unitId)).limit(1);
  return rows[0];
}

export async function createUnit(db: Database, input: NewUnit): Promise<Unit> {
  const rows = await db.insert(unit).values(input).returning();
  return rows[0]!;
}

/** `unit.code` is unique per organization (`unit_organization_id_code_key`). */
export async function findUnitByCode(
  db: Database,
  organizationId: string,
  code: string,
): Promise<Unit | undefined> {
  const rows = await db
    .select()
    .from(unit)
    .where(and(eq(unit.organizationId, organizationId), eq(unit.code, code)))
    .limit(1);
  return rows[0];
}

export interface ListUnitsQuery {
  readonly organizationId: string;
  readonly dimension?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Units for one organization, ordered by `code` (then `id`), with an optional
 * dimension filter. The organization is never optional (`DEC-061`), so the read
 * can never cross tenants; paging is applied after the ordering.
 */
export async function listUnits(db: Database, query: ListUnitsQuery): Promise<Unit[]> {
  const statement = db
    .select()
    .from(unit)
    .where(
      and(
        eq(unit.organizationId, query.organizationId),
        query.dimension === undefined ? undefined : eq(unit.dimension, query.dimension),
      ),
    )
    .orderBy(asc(unit.code), asc(unit.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

/** `item.code` is unique per organization (`item_organization_id_code_key`). */
export async function findItemByCode(
  db: Database,
  organizationId: string,
  code: string,
): Promise<Item | undefined> {
  const rows = await db
    .select()
    .from(item)
    .where(and(eq(item.organizationId, organizationId), eq(item.code, code)))
    .limit(1);
  return rows[0];
}

/** `item.sku` is unique per organization (`item_organization_id_sku_key`). */
export async function findItemBySku(
  db: Database,
  organizationId: string,
  sku: string,
): Promise<Item | undefined> {
  const rows = await db
    .select()
    .from(item)
    .where(and(eq(item.organizationId, organizationId), eq(item.sku, sku)))
    .limit(1);
  return rows[0];
}

/** `product_variant.sku` is unique per organization (`product_variant_organization_id_sku_key`). */
export async function findVariantBySku(
  db: Database,
  query: { readonly organizationId: string; readonly sku: string },
): Promise<{ readonly id: string } | undefined> {
  const rows = await db
    .select({ id: productVariant.id })
    .from(productVariant)
    .where(
      and(
        eq(productVariant.organizationId, query.organizationId),
        eq(productVariant.sku, query.sku),
      ),
    )
    .limit(1);
  return rows[0];
}

/** An `item` row joined to its base unit's `code` (the catalog read projection). */
export interface ItemWithUnit {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly itemType: string;
  readonly baseUnitId: string;
  readonly baseUnitCode: string;
  readonly inventoryPolicy: string;
  readonly lotTracked: boolean;
  /** numeric(19,4); null when the item has no recorded cost yet. */
  readonly currentCost: string | null;
  /** `date` (`yyyy-mm-dd`). */
  readonly activeFrom: string;
  /** `date` (`yyyy-mm-dd`), null while the item is still active. */
  readonly activeTo: string | null;
}

const itemWithUnitColumns = {
  id: item.id,
  organizationId: item.organizationId,
  code: item.code,
  sku: item.sku,
  name: item.name,
  itemType: item.itemType,
  baseUnitId: item.baseUnitId,
  baseUnitCode: unit.code,
  inventoryPolicy: item.inventoryPolicy,
  lotTracked: item.lotTracked,
  currentCost: item.currentCost,
  activeFrom: item.activeFrom,
  activeTo: item.activeTo,
} as const;

export interface ListItemsQuery {
  readonly organizationId: string;
  /** Case-insensitive contains match over code, SKU and name. */
  readonly search?: string;
  readonly itemType?: string;
  readonly limit: number;
  readonly offset: number;
}

/** Escapes `\`, `%` and `_` so a search term is matched literally (ILIKE default escape). */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function itemFilters(query: ListItemsQuery): SQL[] {
  const filters: SQL[] = [eq(item.organizationId, query.organizationId)];
  const search = query.search?.trim();
  if (search !== undefined && search.length > 0) {
    const pattern = `%${escapeLikePattern(search)}%`;
    const searchFilter = or(
      ilike(item.code, pattern),
      ilike(item.sku, pattern),
      ilike(item.name, pattern),
    );
    if (searchFilter !== undefined) {
      filters.push(searchFilter);
    }
  }
  if (query.itemType !== undefined && query.itemType.length > 0) {
    filters.push(eq(item.itemType, query.itemType));
  }
  return filters;
}

/**
 * One page of organization items joined to their base unit, ordered by `code`,
 * plus the total matching count (for the UI pager). The caller validates
 * `limit`/`offset`; this repository passes them straight to SQL.
 */
export async function listItems(
  db: Database,
  query: ListItemsQuery,
): Promise<{ readonly rows: ItemWithUnit[]; readonly total: number }> {
  const filters = itemFilters(query);
  const rows = await db
    .select(itemWithUnitColumns)
    .from(item)
    .innerJoin(unit, eq(item.baseUnitId, unit.id))
    .where(and(...filters))
    .orderBy(asc(item.code))
    .limit(query.limit)
    .offset(query.offset);
  const counted = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(item)
    .where(and(...filters));
  return { rows, total: counted[0]?.total ?? 0 };
}

/** A single item joined to its base unit, by id (organization-agnostic; the caller scopes). */
export async function findItemWithUnitById(
  db: Database,
  itemId: string,
): Promise<ItemWithUnit | undefined> {
  const rows = await db
    .select(itemWithUnitColumns)
    .from(item)
    .innerJoin(unit, eq(item.baseUnitId, unit.id))
    .where(eq(item.id, itemId))
    .limit(1);
  return rows[0];
}

/** A `supplier_item` joined to its supplier and pack unit (the item-detail read projection). */
export interface SupplierItemWithRefs {
  readonly id: string;
  readonly organizationId: string;
  readonly supplierId: string;
  readonly supplierCode: string;
  readonly supplierName: string;
  readonly itemId: string;
  readonly supplierSku: string;
  readonly packUnitId: string;
  readonly packUnitCode: string;
  readonly packToBaseUnitFactor: string;
  readonly minOrderQty: string | null;
  readonly leadTimeDays: number | null;
  readonly preferred: boolean;
}

/** The supplier packs registered for one item, ordered by supplier SKU. */
export async function listSupplierItemsForItem(
  db: Database,
  organizationId: string,
  itemId: string,
): Promise<SupplierItemWithRefs[]> {
  return db
    .select({
      id: supplierItem.id,
      organizationId: supplierItem.organizationId,
      supplierId: supplierItem.supplierId,
      supplierCode: supplier.code,
      supplierName: supplier.name,
      itemId: supplierItem.itemId,
      supplierSku: supplierItem.supplierSku,
      packUnitId: supplierItem.packUnitId,
      packUnitCode: unit.code,
      packToBaseUnitFactor: supplierItem.packToBaseUnitFactor,
      minOrderQty: supplierItem.minOrderQty,
      leadTimeDays: supplierItem.leadTimeDays,
      preferred: supplierItem.preferred,
    })
    .from(supplierItem)
    .innerJoin(supplier, eq(supplierItem.supplierId, supplier.id))
    .innerJoin(unit, eq(supplierItem.packUnitId, unit.id))
    .where(and(eq(supplierItem.organizationId, organizationId), eq(supplierItem.itemId, itemId)))
    .orderBy(asc(supplierItem.supplierSku));
}

export async function createSupplier(db: Database, input: NewSupplier): Promise<Supplier> {
  const rows = await db.insert(supplier).values(input).returning();
  return rows[0]!;
}

export async function findSupplierById(
  db: Database,
  supplierId: string,
): Promise<Supplier | undefined> {
  const rows = await db.select().from(supplier).where(eq(supplier.id, supplierId)).limit(1);
  return rows[0];
}

export async function findSupplierByCode(
  db: Database,
  organizationId: string,
  code: string,
): Promise<Supplier | undefined> {
  const rows = await db
    .select()
    .from(supplier)
    .where(and(eq(supplier.organizationId, organizationId), eq(supplier.code, code)))
    .limit(1);
  return rows[0];
}

export async function createSupplierItem(
  db: Database,
  input: NewSupplierItem,
): Promise<SupplierItem> {
  const rows = await db.insert(supplierItem).values(input).returning();
  return rows[0]!;
}

/** `supplier_sku` is unique per supplier (`DATA_DICTIONARY` §2). */
export async function findSupplierItemBySku(
  db: Database,
  supplierId: string,
  supplierSku: string,
): Promise<SupplierItem | undefined> {
  const rows = await db
    .select()
    .from(supplierItem)
    .where(and(eq(supplierItem.supplierId, supplierId), eq(supplierItem.supplierSku, supplierSku)))
    .limit(1);
  return rows[0];
}

export async function createUnitConversion(
  db: Database,
  input: NewUnitConversion,
): Promise<UnitConversion> {
  const rows = await db.insert(unitConversion).values(input).returning();
  return rows[0]!;
}

/** One effective `unit_conversion` row joined to both units' identity fields. */
export interface EffectiveConversion {
  readonly fromUnitId: string;
  readonly fromUnitCode: string;
  readonly fromUnitDimension: string;
  readonly fromUnitIsBase: boolean;
  readonly toUnitId: string;
  readonly toUnitCode: string;
  readonly toUnitDimension: string;
  readonly toUnitIsBase: boolean;
  readonly factor: string;
  readonly itemId: string | null;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export interface EffectiveConversionQuery {
  readonly organizationId: string;
  readonly asOf: Date;
  /** When absent/null, only global (`item_id is null`) conversions are returned. */
  readonly itemId?: string | null;
}

/**
 * Lists the conversions effective at `asOf` (half-open `[effective_from,
 * effective_to)`), joined to both units so the domain resolver needs no further
 * lookups. A non-null `itemId` returns global rows *and* rows scoped to that
 * item; resolving a conflict between them is deliberately left to FND-003
 * (ambiguity rejected) because the item-vs-global precedence is not documented.
 */
export async function listEffectiveConversions(
  db: Database,
  query: EffectiveConversionQuery,
): Promise<EffectiveConversion[]> {
  const fromUnit = alias(unit, "from_unit");
  const toUnit = alias(unit, "to_unit");
  const itemFilter =
    query.itemId === undefined || query.itemId === null
      ? isNull(unitConversion.itemId)
      : or(isNull(unitConversion.itemId), eq(unitConversion.itemId, query.itemId));
  const rows = await db
    .select({
      fromUnitId: unitConversion.fromUnitId,
      fromUnitCode: fromUnit.code,
      fromUnitDimension: fromUnit.dimension,
      fromUnitIsBase: fromUnit.isBase,
      toUnitId: unitConversion.toUnitId,
      toUnitCode: toUnit.code,
      toUnitDimension: toUnit.dimension,
      toUnitIsBase: toUnit.isBase,
      factor: unitConversion.factor,
      itemId: unitConversion.itemId,
      effectiveFrom: unitConversion.effectiveFrom,
      effectiveTo: unitConversion.effectiveTo,
    })
    .from(unitConversion)
    .innerJoin(fromUnit, eq(unitConversion.fromUnitId, fromUnit.id))
    .innerJoin(toUnit, eq(unitConversion.toUnitId, toUnit.id))
    .where(
      and(
        eq(unitConversion.organizationId, query.organizationId),
        lte(unitConversion.effectiveFrom, query.asOf),
        or(isNull(unitConversion.effectiveTo), gt(unitConversion.effectiveTo, query.asOf)),
        itemFilter,
      ),
    );
  return rows;
}

export async function createCostCenter(db: Database, input: NewCostCenter): Promise<CostCenter> {
  const rows = await db.insert(costCenter).values(input).returning();
  return rows[0]!;
}

export async function findCostCenterByCode(
  db: Database,
  organizationId: string,
  code: string,
): Promise<CostCenter | undefined> {
  const rows = await db
    .select()
    .from(costCenter)
    .where(and(eq(costCenter.organizationId, organizationId), eq(costCenter.code, code)))
    .limit(1);
  return rows[0];
}
