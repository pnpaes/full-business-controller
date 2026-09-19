import { sql } from "drizzle-orm";
import { check, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { currency, effectiveRange, enumCheck, money, orgId, rangeCheck, uuidPk } from "./columns";
import { organization } from "./organization";
import { taxRule } from "./tax";
import { TAX_BASIS } from "./vocabularies";

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
    check("supplier_price_effective_range_check", rangeCheck(t.effectiveFrom, t.effectiveTo)),
    // supplier_price_no_overlap (exclusion constraint) is emitted in the raw
    // `invariants` migration: drizzle-kit 0.30 cannot express exclusion constraints.
  ],
);
