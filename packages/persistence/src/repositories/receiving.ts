import { and, eq, gt, isNull, lte, or } from "drizzle-orm";

import type { Database } from "../client";
import {
  costObservation,
  goodsReceipt,
  goodsReceiptLine,
  supplierItem,
  supplierPrice,
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
