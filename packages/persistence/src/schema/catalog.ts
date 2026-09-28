import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  currency,
  effectiveRange,
  enumCheck,
  money,
  orgId,
  quantity,
  rangeCheck,
  tstz,
  uuidPk,
} from "./columns";
import { organization } from "./organization";
import { COST_SOURCE, INVENTORY_POLICY, ITEM_TYPE, UNIT_DIMENSION } from "./vocabularies";

/**
 * `DEC-150` (accepted 2026-09-28): a stock item's purpose. `for_sale` is a
 * stocked item a sellable is fulfilled from (today's `finished_good`); `for_use`
 * is an input consumed by production/operations that no variant may reference.
 * Stocking/tracking is not the axis — purpose is, and it is stored as data, not
 * as a type mapping (`item_type` is only the backfill source). Defined here
 * rather than in `vocabularies.ts` on purpose: the `vocabularies.test.ts` guard
 * requires every exported vocabulary to have a matching
 * `schemas/domain-enums.yaml` key, and that input is not edited by this change.
 */
export const ITEM_PURPOSE = ["for_sale", "for_use"] as const;

export const unit = pgTable(
  "unit",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    code: text("code").notNull(),
    dimension: text("dimension").notNull(),
    isBase: boolean("is_base").notNull().default(false),
  },
  (t) => [
    check("unit_dimension_check", enumCheck(t.dimension, UNIT_DIMENSION)),
    unique("unit_organization_id_code_key").on(t.organizationId, t.code),
  ],
);

export const item = pgTable(
  "item",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    code: text("code").notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    itemType: text("item_type").notNull(),
    // `DEC-150`: `for_sale` vs `for_use`. Backfilled from `item_type` in the
    // `0079_item_purpose` migration (`finished_good` ⇒ `for_sale`, else
    // `for_use`), then freely editable; the column default is `for_use`.
    purpose: text("purpose").notNull().default("for_use"),
    baseUnitId: uuid("base_unit_id")
      .notNull()
      .references(() => unit.id),
    inventoryPolicy: text("inventory_policy").notNull().default("stocked"),
    lotTracked: boolean("lot_tracked").notNull().default(false),
    shelfLifeDays: integer("shelf_life_days"),
    standardPortionSize: quantity("standard_portion_size"),
    portionUnitId: uuid("portion_unit_id").references(() => unit.id),
    currentCost: money("current_cost"),
    currentCostUpdatedAt: tstz("current_cost_updated_at"),
    activeFrom: date("active_from")
      .notNull()
      .default(sql`current_date`),
    activeTo: date("active_to"),
  },
  (t) => [
    check("item_item_type_check", enumCheck(t.itemType, ITEM_TYPE)),
    check("item_purpose_check", enumCheck(t.purpose, ITEM_PURPOSE)),
    check("item_inventory_policy_check", enumCheck(t.inventoryPolicy, INVENTORY_POLICY)),
    check("item_shelf_life_days_check", sql`${t.shelfLifeDays} is null or ${t.shelfLifeDays} >= 0`),
    check(
      "item_standard_portion_size_check",
      sql`${t.standardPortionSize} is null or ${t.standardPortionSize} > 0`,
    ),
    check("item_current_cost_check", sql`${t.currentCost} is null or ${t.currentCost} >= 0`),
    check("item_active_range_check", rangeCheck(t.activeFrom, t.activeTo)),
    unique("item_organization_id_code_key").on(t.organizationId, t.code),
    unique("item_organization_id_sku_key").on(t.organizationId, t.sku),
    // The Stock screen's For sale / For use tabs filter on this pair.
    index("item_organization_id_purpose_idx").on(t.organizationId, t.purpose),
  ],
);

export const costObservation = pgTable(
  "cost_observation",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => item.id),
    storeName: text("store_name"),
    observedAt: date("observed_at").notNull(),
    packSize: quantity("pack_size"),
    packUnitId: uuid("pack_unit_id").references(() => unit.id),
    packPrice: money("pack_price"),
    currency: currency().notNull(),
    source: text("source").notNull(),
    // FK file_object(id) stays deferred (the table now exists, `DEC-085`).
    receiptFileId: uuid("receipt_file_id"),
    notes: text("notes"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("cost_observation_pack_size_check", sql`${t.packSize} is null or ${t.packSize} > 0`),
    check("cost_observation_pack_price_check", sql`${t.packPrice} is null or ${t.packPrice} >= 0`),
    check("cost_observation_source_check", enumCheck(t.source, COST_SOURCE)),
    index("cost_observation_item_idx").on(t.organizationId, t.itemId, t.observedAt),
  ],
);

/**
 * `unit_conversion` (`DATA_DICTIONARY` §2): the effective-dated, optionally
 * item-scoped conversion graph (FND-003). `item_id` is null for a global factor
 * and set for a pack/density-specific one. Overlapping effective windows within
 * one scope are rejected by the hand-written
 * `0005_unit_conversion_invariants` (two gist exclusion constraints plus a
 * `NULLS NOT DISTINCT` version key), deliberately outside drizzle-kit as
 * `0002_invariants` is. The cross-scope case — a global and a matching
 * item-scoped edge that disagree — stays deliberately undecided (DEC-050): the
 * domain resolver rejects it as ambiguous instead of guessing a precedence, so
 * no item-over-global priority is emitted here.
 */
export const unitConversion = pgTable(
  "unit_conversion",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    fromUnitId: uuid("from_unit_id")
      .notNull()
      .references(() => unit.id),
    toUnitId: uuid("to_unit_id")
      .notNull()
      .references(() => unit.id),
    factor: quantity("factor").notNull(),
    itemId: uuid("item_id").references(() => item.id),
    ...effectiveRange(),
  },
  (t) => [
    check("unit_conversion_factor_check", sql`${t.factor} > 0`),
    check("unit_conversion_effective_range_check", rangeCheck(t.effectiveFrom, t.effectiveTo)),
    index("unit_conversion_lookup_idx").on(t.organizationId, t.fromUnitId, t.toUnitId),
  ],
);
