import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { item, unit } from "./catalog";
import { currency, effectiveRange, enumCheck, money, orgId, quantity, uuidPk } from "./columns";
import { organization } from "./organization";
import { taxRule } from "./tax";
import { TAX_BASIS } from "./vocabularies";

/**
 * `supplier` (`DATA_DICTIONARY` §2). Supplier relationships are **optional**
 * (DEC-047): an ad-hoc grocery purchase is recorded as a `cost_observation`
 * instead, so this table is only for real, known suppliers.
 */
export const supplier = pgTable(
  "supplier",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    contact: text("contact"),
    terms: text("terms"),
    currency: currency().notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [unique("supplier_organization_id_code_key").on(t.organizationId, t.code)],
);

/**
 * `supplier_item` (`DATA_DICTIONARY` §2, PROC-001): one pack of `item_id` bought
 * from `supplier_id`, with `1 pack_unit = pack_to_base_unit_factor × base unit`.
 * The base unit is the referenced item's `base_unit_id` (PROC-001); the
 * `pack_to_base_unit_factor` is validated against it by `SupplierPack`.
 */
export const supplierItem = pgTable(
  "supplier_item",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => supplier.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => item.id),
    supplierSku: text("supplier_sku").notNull(),
    packUnitId: uuid("pack_unit_id")
      .notNull()
      .references(() => unit.id),
    packToBaseUnitFactor: quantity("pack_to_base_unit_factor").notNull(),
    minOrderQty: quantity("min_order_qty"),
    leadTimeDays: integer("lead_time_days"),
    preferred: boolean("preferred").notNull().default(false),
  },
  (t) => [
    check("supplier_item_pack_to_base_unit_factor_check", sql`${t.packToBaseUnitFactor} > 0`),
    check(
      "supplier_item_min_order_qty_check",
      sql`${t.minOrderQty} is null or ${t.minOrderQty} > 0`,
    ),
    check(
      "supplier_item_lead_time_days_check",
      sql`${t.leadTimeDays} is null or ${t.leadTimeDays} >= 0`,
    ),
    unique("supplier_item_supplier_id_supplier_sku_key").on(t.supplierId, t.supplierSku),
  ],
);

export const supplierPrice = pgTable(
  "supplier_price",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    // FK supplier_item when that slice is declared (deferred, DEC-047).
    supplierItemId: uuid("supplier_item_id").notNull(),
    grossPackPrice: money("gross_pack_price").notNull(),
    discount: money("discount").notNull().default("0"),
    taxBasis: text("tax_basis").notNull(),
    taxRuleId: uuid("tax_rule_id").references(() => taxRule.id),
    allocatedFreight: money("allocated_freight").notNull().default("0"),
    importFee: money("import_fee").notNull().default("0"),
    otherCost: money("other_cost").notNull().default("0"),
    netPackPrice: money("net_pack_price").notNull(),
    landedPackCost: money("landed_pack_cost").notNull(),
    landedBaseUnitCost: money("landed_base_unit_cost").notNull(),
    currency: currency().notNull(),
    // Provenance; FK goods_receipt when that slice is declared (deferred).
    sourceReceiptId: uuid("source_receipt_id"),
    ...effectiveRange(),
  },
  (t) => [
    check("supplier_price_gross_pack_price_check", sql`${t.grossPackPrice} >= 0`),
    check("supplier_price_discount_check", sql`${t.discount} >= 0`),
    check("supplier_price_tax_basis_check", enumCheck(t.taxBasis, TAX_BASIS)),
    // Half-open `[)` history: a same-instant re-record closes the previous
    // window at `effective_from` (an empty interval), which is non-overlapping
    // under `supplier_price_no_overlap`. `effective_to > effective_from` would
    // reject that empty window, so equality is permitted here.
    check(
      "supplier_price_effective_range_check",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
    // supplier_price_no_overlap (exclusion constraint) is emitted in the raw
    // `invariants` migration: drizzle-kit 0.30 cannot express exclusion constraints.
  ],
);
