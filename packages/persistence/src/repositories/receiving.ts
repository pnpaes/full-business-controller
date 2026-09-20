import { and, asc, desc, eq, getTableColumns, gt, isNull, lte, or, sql } from "drizzle-orm";

import type { Database } from "../client";
import {
  costObservation,
  goodsReceipt,
  goodsReceiptLine,
  item,
  location,
  supplier,
  supplierItem,
  supplierPrice,
  unit,
} from "../schema";

export type GoodsReceipt = typeof goodsReceipt.$inferSelect;
export type NewGoodsReceipt = typeof goodsReceipt.$inferInsert;
export type GoodsReceiptLine = typeof goodsReceiptLine.$inferSelect;
export type NewGoodsReceiptLine = typeof goodsReceiptLine.$inferInsert;
export type SupplierPrice = typeof supplierPrice.$inferSelect;
export type NewSupplierPrice = typeof supplierPrice.$inferInsert;
export type CostObservation = typeof costObservation.$inferSelect;
export type NewCostObservation = typeof costObservation.$inferInsert;
/** Named to avoid colliding with `master-data`'s `SupplierItem` in the barrel. */
export type GoodsReceiptSupplierItem = typeof supplierItem.$inferSelect;

export async function createGoodsReceipt(
  db: Database,
  input: NewGoodsReceipt,
): Promise<GoodsReceipt> {
  const rows = await db.insert(goodsReceipt).values(input).returning();
  return rows[0]!;
}

export async function findGoodsReceiptById(
  db: Database,
  goodsReceiptId: string,
): Promise<GoodsReceipt | undefined> {
  const rows = await db
    .select()
    .from(goodsReceipt)
    .where(eq(goodsReceipt.id, goodsReceiptId))
    .limit(1);
  return rows[0];
}

/** Lines of one receipt, unordered (no sequence column in the dictionary). */
export async function listGoodsReceiptLines(
  db: Database,
  goodsReceiptId: string,
): Promise<GoodsReceiptLine[]> {
  return db
    .select()
    .from(goodsReceiptLine)
    .where(eq(goodsReceiptLine.goodsReceiptId, goodsReceiptId));
}

export async function createGoodsReceiptLine(
  db: Database,
  input: NewGoodsReceiptLine,
): Promise<GoodsReceiptLine> {
  const rows = await db.insert(goodsReceiptLine).values(input).returning();
  return rows[0]!;
}

export async function findSupplierItemById(
  db: Database,
  supplierItemId: string,
): Promise<GoodsReceiptSupplierItem | undefined> {
  const rows = await db
    .select()
    .from(supplierItem)
    .where(eq(supplierItem.id, supplierItemId))
    .limit(1);
  return rows[0];
}

/** Effective-dated price rows for a supplier item (unordered). */
export async function listSupplierPricesForSupplierItem(
  db: Database,
  supplierItemId: string,
): Promise<SupplierPrice[]> {
  return db.select().from(supplierPrice).where(eq(supplierPrice.supplierItemId, supplierItemId));
}

/** Cost observations for an item (unordered). */
export async function listCostObservationsForItem(
  db: Database,
  itemId: string,
): Promise<CostObservation[]> {
  return db.select().from(costObservation).where(eq(costObservation.itemId, itemId));
}

/** Goods receipts for an organization (unordered). */
export async function listGoodsReceiptsForOrganization(
  db: Database,
  organizationId: string,
): Promise<GoodsReceipt[]> {
  return db.select().from(goodsReceipt).where(eq(goodsReceipt.organizationId, organizationId));
}

/**
 * Closes every currently-effective `supplier_price` window for a supplier item
 * at `at`, so the newly appended price cannot overlap the previous one
 * (`supplier_price_no_overlap`): `DATA_DICTIONARY` §2 requires effective-dated,
 * non-overlapping history per supplier item. Returns the number closed.
 */
export async function closeOpenSupplierPrices(
  db: Database,
  supplierItemId: string,
  at: Date,
): Promise<number> {
  const rows = await db
    .update(supplierPrice)
    .set({ effectiveTo: at })
    .where(
      and(
        eq(supplierPrice.supplierItemId, supplierItemId),
        lte(supplierPrice.effectiveFrom, at),
        or(isNull(supplierPrice.effectiveTo), gt(supplierPrice.effectiveTo, at)),
      ),
    )
    .returning({ id: supplierPrice.id });
  return rows.length;
}

export async function createSupplierPrice(
  db: Database,
  input: NewSupplierPrice,
): Promise<SupplierPrice> {
  const rows = await db.insert(supplierPrice).values(input).returning();
  return rows[0]!;
}

export async function createCostObservation(
  db: Database,
  input: NewCostObservation,
): Promise<CostObservation> {
  const rows = await db.insert(costObservation).values(input).returning();
  return rows[0]!;
}

/* --------------------------- receiving read model --------------------------- */

/**
 * One receipt plus the derived gross total (Σ line `price × received_pack_qty`,
 * each product rounded HALF_UP to money scale so it matches the application's
 * `Money.multiply`). The total is computed in SQL rather than stored: the
 * dictionary has no total column and the lines are the append-only facts.
 */
export interface GoodsReceiptSummary extends GoodsReceipt {
  /** numeric(19,4) text. */
  readonly grossTotal: string;
}

export interface ListGoodsReceiptSummariesQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly supplierId?: string;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Receipts for one organization, newest first (`received_at`, then `id`), with
 * their gross total. Every filter is optional except the organization, so the
 * caller never sees another tenant's rows.
 */
export async function listGoodsReceiptSummaries(
  db: Database,
  query: ListGoodsReceiptSummariesQuery,
): Promise<GoodsReceiptSummary[]> {
  const grossTotal = sql<string>`cast(coalesce(sum(round(${goodsReceiptLine.price} * ${goodsReceiptLine.receivedPackQty}, 4)), 0) as numeric(19, 4))::text`;
  return db
    .select({ ...getTableColumns(goodsReceipt), grossTotal })
    .from(goodsReceipt)
    .leftJoin(goodsReceiptLine, eq(goodsReceiptLine.goodsReceiptId, goodsReceipt.id))
    .where(
      and(
        eq(goodsReceipt.organizationId, query.organizationId),
        query.locationId === undefined ? undefined : eq(goodsReceipt.locationId, query.locationId),
        query.supplierId === undefined ? undefined : eq(goodsReceipt.supplierId, query.supplierId),
      ),
    )
    .groupBy(goodsReceipt.id)
    .orderBy(desc(goodsReceipt.receivedAt), desc(goodsReceipt.id))
    .limit(query.limit)
    .offset(query.offset);
}

/** One receipt summary by id, with its gross total; org-checked by the caller. */
export async function findGoodsReceiptSummaryById(
  db: Database,
  goodsReceiptId: string,
): Promise<GoodsReceiptSummary | undefined> {
  const grossTotal = sql<string>`cast(coalesce(sum(round(${goodsReceiptLine.price} * ${goodsReceiptLine.receivedPackQty}, 4)), 0) as numeric(19, 4))::text`;
  const rows = await db
    .select({ ...getTableColumns(goodsReceipt), grossTotal })
    .from(goodsReceipt)
    .leftJoin(goodsReceiptLine, eq(goodsReceiptLine.goodsReceiptId, goodsReceipt.id))
    .where(eq(goodsReceipt.id, goodsReceiptId))
    .groupBy(goodsReceipt.id)
    .limit(1);
  return rows[0];
}

/** The currently-open effective `supplier_price` for a supplier item, if any. */
export async function findOpenSupplierPrice(
  db: Database,
  supplierItemId: string,
): Promise<SupplierPrice | undefined> {
  const rows = await db
    .select()
    .from(supplierPrice)
    .where(and(eq(supplierPrice.supplierItemId, supplierItemId), isNull(supplierPrice.effectiveTo)))
    .orderBy(desc(supplierPrice.effectiveFrom))
    .limit(1);
  return rows[0];
}

/** Suppliers for an organization, ordered by code (the receiving picker). */
export async function listSuppliersForOrganization(
  db: Database,
  organizationId: string,
): Promise<(typeof supplier.$inferSelect)[]> {
  return db
    .select()
    .from(supplier)
    .where(eq(supplier.organizationId, organizationId))
    .orderBy(asc(supplier.code));
}

/** Locations for an organization, ordered by code (the receiving picker). */
export async function listLocationsForOrganization(
  db: Database,
  organizationId: string,
): Promise<(typeof location.$inferSelect)[]> {
  return db
    .select()
    .from(location)
    .where(eq(location.organizationId, organizationId))
    .orderBy(asc(location.code));
}

/**
 * One receivable pack option: a `supplier_item` joined to its item (code, name,
 * base unit) and pack unit, so the receiving form can pick a pack and derive the
 * item, the pack unit and the conversion factor without extra lookups.
 */
export interface ReceivingSupplierItemOption {
  readonly id: string;
  readonly organizationId: string;
  readonly supplierId: string;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly baseUnitId: string;
  readonly packUnitId: string;
  readonly packUnitCode: string;
  /** numeric(19,6) text. */
  readonly packToBaseUnitFactor: string;
}

export async function listReceivingSupplierItemOptions(
  db: Database,
  organizationId: string,
): Promise<ReceivingSupplierItemOption[]> {
  return db
    .select({
      id: supplierItem.id,
      organizationId: supplierItem.organizationId,
      supplierId: supplierItem.supplierId,
      itemId: supplierItem.itemId,
      itemCode: item.code,
      itemName: item.name,
      baseUnitId: item.baseUnitId,
      packUnitId: supplierItem.packUnitId,
      packUnitCode: unit.code,
      packToBaseUnitFactor: supplierItem.packToBaseUnitFactor,
    })
    .from(supplierItem)
    .innerJoin(item, eq(item.id, supplierItem.itemId))
    .innerJoin(unit, eq(unit.id, supplierItem.packUnitId))
    .where(eq(supplierItem.organizationId, organizationId))
    .orderBy(asc(item.name), asc(supplierItem.supplierSku));
}
