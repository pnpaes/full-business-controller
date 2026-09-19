import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "../client";
import { costCenter, item, supplier, supplierItem, unit, unitConversion } from "../schema";

export type Item = typeof item.$inferSelect;
export type NewItem = typeof item.$inferInsert;
export type Unit = typeof unit.$inferSelect;
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
