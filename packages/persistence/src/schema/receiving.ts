import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

import { item, unit } from "./catalog";
import { auditColumns, enumCheck, money, orgId, quantity, tstz, uuidPk } from "./columns";
import { location, organization } from "./organization";
import { supplier } from "./supplier";
import { taxRule } from "./tax";
import { RECEIPT_STATUS, TAX_BASIS } from "./vocabularies";

/**
 * `goods_receipt` (`DATA_DICTIONARY` §5, PROC-002). `supplier_id` is **nullable**
 * (DEC-047): an ad-hoc grocery purchase has no supplier master and falls back to
 * the free-text `store_name`. `purchase_order_id` stays a plain uuid (its table
 * is deferred to a later slice); `evidence_file_id` is a plain uuid too —
 * `file_object` now exists (`DEC-085`) but this deferred FK stays open.
 */
export const goodsReceipt = pgTable(
  "goods_receipt",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    supplierId: uuid("supplier_id").references(() => supplier.id),
    storeName: text("store_name"),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    // FK purchase_order(id) when that table is declared (deferred slice).
    purchaseOrderId: uuid("purchase_order_id"),
    deliveryRef: text("delivery_ref"),
    receivedAt: tstz("received_at").notNull(),
    status: text("status").notNull().default("draft"),
    // FK app_user(id) is deferred like audit_event.actor_id (deferred-FK convention).
    acceptedBy: uuid("accepted_by"),
    acceptedAt: tstz("accepted_at"),
    reversalOfId: uuid("reversal_of_id").references((): AnyPgColumn => goodsReceipt.id),
    // FK file_object(id) stays deferred (the table now exists, `DEC-085`).
    evidenceFileId: uuid("evidence_file_id"),
    ...auditColumns(),
  },
  (t) => [
    check("goods_receipt_status_check", enumCheck(t.status, RECEIPT_STATUS)),
    // DEC-047: a purchase is either from a known supplier or from a free-text store.
    check(
      "goods_receipt_supplier_or_store_check",
      sql`${t.supplierId} is not null or (${t.storeName} is not null and btrim(${t.storeName}) <> '')`,
    ),
    // Mirrors `approvalCheck`: an accepted receipt records who accepted it and when.
    check(
      "goods_receipt_accepted_check",
      sql`${t.status} <> 'accepted' or (${t.acceptedBy} is not null and ${t.acceptedAt} is not null)`,
    ),
    index("goods_receipt_org_received_idx").on(t.organizationId, t.receivedAt),
  ],
);

/**
 * `goods_receipt_line` (`DATA_DICTIONARY` §5). `unit_id` is the **pack** unit and
 * `pack_to_base_factor` converts one pack to the item's base unit; the landed
 * cost is computed per line (the per-line `allocated_freight`/`import_fee` are
 * supplied, because receipt-level apportionment is not pinned down by the
 * contract). `supplier_item_id` is nullable (DEC-047). There is deliberately no
 * `currency`/`other_acquisition_cost` column: the dictionary does not specify
 * them (see the slice report for the recorded ambiguities).
 */
export const goodsReceiptLine = pgTable(
  "goods_receipt_line",
  {
    id: uuidPk(),
    goodsReceiptId: uuid("goods_receipt_id")
      .notNull()
      .references(() => goodsReceipt.id, { onDelete: "cascade" }),
    // FK supplier_item(id) is deferred like supplier_price.supplier_item_id.
    supplierItemId: uuid("supplier_item_id"),
    itemId: uuid("item_id")
      .notNull()
      .references(() => item.id),
    receivedPackQty: quantity("received_pack_qty").notNull(),
    acceptedPackQty: quantity("accepted_pack_qty").notNull(),
    rejectedPackQty: quantity("rejected_pack_qty").notNull().default("0"),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => unit.id),
    packToBaseFactor: quantity("pack_to_base_factor").notNull(),
    price: money("price").notNull(),
    discount: money("discount").notNull().default("0"),
    taxBasis: text("tax_basis").notNull(),
    taxCodeId: uuid("tax_code_id").references(() => taxRule.id),
    allocatedFreight: money("allocated_freight").notNull().default("0"),
    importFee: money("import_fee").notNull().default("0"),
    lotNumber: text("lot_number"),
    expiryDate: date("expiry_date"),
    baseQtyAccepted: quantity("base_qty_accepted").notNull(),
    landedBaseUnitCost: money("landed_base_unit_cost").notNull(),
  },
  (t) => [
    check("goods_receipt_line_tax_basis_check", enumCheck(t.taxBasis, TAX_BASIS)),
    check("goods_receipt_line_received_pack_qty_check", sql`${t.receivedPackQty} >= 0`),
    check("goods_receipt_line_accepted_pack_qty_check", sql`${t.acceptedPackQty} >= 0`),
    check("goods_receipt_line_rejected_pack_qty_check", sql`${t.rejectedPackQty} >= 0`),
    check(
      "goods_receipt_line_accepted_le_received_check",
      sql`${t.acceptedPackQty} <= ${t.receivedPackQty}`,
    ),
    check("goods_receipt_line_pack_to_base_factor_check", sql`${t.packToBaseFactor} > 0`),
    check("goods_receipt_line_price_check", sql`${t.price} >= 0`),
    check("goods_receipt_line_discount_check", sql`${t.discount} >= 0`),
    check("goods_receipt_line_allocated_freight_check", sql`${t.allocatedFreight} >= 0`),
    check("goods_receipt_line_import_fee_check", sql`${t.importFee} >= 0`),
    // §5 rejects base_units_received <= 0; accepted > 0 with factor > 0 implies it.
    check("goods_receipt_line_base_qty_accepted_check", sql`${t.baseQtyAccepted} > 0`),
    check("goods_receipt_line_landed_base_unit_cost_check", sql`${t.landedBaseUnitCost} >= 0`),
    index("goods_receipt_line_receipt_idx").on(t.goodsReceiptId),
  ],
);
