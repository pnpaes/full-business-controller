import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { item, unit } from "./catalog";
import {
  approvalCheck,
  enumCheck,
  jsonObject,
  money,
  orgId,
  quantity,
  tstz,
  uuidPk,
} from "./columns";
import { channel, location, organization } from "./organization";
import { productVariant } from "./products";
import { recipeVersion } from "./recipes";
import { exchangeRate } from "./tax";
import {
  COST_CARD_STATE,
  PRICE_SCENARIO_STATE,
  ROUNDING_BOUNDARY,
  ROUNDING_METHOD,
} from "./vocabularies";

export const priceScenario = pgTable(
  "price_scenario",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    productVariantId: uuid("product_variant_id")
      .notNull()
      .references(() => productVariant.id),
    locationId: uuid("location_id").references(() => location.id),
    channelId: uuid("channel_id").references(() => channel.id),
    grossPrice: money("gross_price"),
    netPrice: money("net_price"),
    state: text("state").notNull().default("draft"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("price_scenario_state_check", enumCheck(t.state, PRICE_SCENARIO_STATE)),
    index("price_scenario_variant_idx").on(t.organizationId, t.productVariantId),
  ],
);

export const costCard = pgTable(
  "cost_card",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    productVariantId: uuid("product_variant_id")
      .notNull()
      .references(() => productVariant.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    channelId: uuid("channel_id").references(() => channel.id),
    recipeVersionId: uuid("recipe_version_id").references(() => recipeVersion.id),
    state: text("state").notNull().default("draft"),
    costSelectionPolicy: text("cost_selection_policy").notNull().default("latest_approved_price"),
    calculatedAt: tstz("calculated_at").notNull().defaultNow(),
    approvedBy: uuid("approved_by"),
    approvedAt: tstz("approved_at"),
    // Mutually referential with calculation_snapshot.cost_card_id; the
    // deferrable FKs on both sides are emitted in the raw `invariants` migration.
    snapshotId: uuid("snapshot_id"),
  },
  (t) => [
    check("cost_card_state_check", enumCheck(t.state, COST_CARD_STATE)),
    check("cost_card_approval_check", approvalCheck(t.state, t.approvedBy, t.approvedAt)),
    index("cost_card_variant_idx").on(
      t.organizationId,
      t.productVariantId,
      t.locationId,
      t.calculatedAt,
    ),
  ],
);

export const calculationSnapshot = pgTable(
  "calculation_snapshot",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    // Deferrable FK to cost_card(id) added in the raw `invariants` migration.
    costCardId: uuid("cost_card_id"),
    priceScenarioId: uuid("price_scenario_id").references(() => priceScenario.id),
    costSelectionPolicy: text("cost_selection_policy").notNull(),
    asOf: tstz("as_of").notNull(),
    taxRuleSnapshot: jsonObject("tax_rule_snapshot"),
    fxRateId: uuid("fx_rate_id").references(() => exchangeRate.id),
    roundingMethod: text("rounding_method").notNull().default("HALF_UP"),
    roundingScales: jsonb("rounding_scales")
      .notNull()
      .default(sql`'{"qty":6,"money":4,"presented":2}'::jsonb`),
    ruleVersion: text("rule_version").notNull(),
    totals: jsonb("totals").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "calculation_snapshot_rounding_method_check",
      enumCheck(t.roundingMethod, ROUNDING_METHOD),
    ),
    check(
      "calculation_snapshot_source_check",
      sql`(${t.costCardId} is not null)::int + (${t.priceScenarioId} is not null)::int = 1`,
    ),
    check(
      "calculation_snapshot_tax_rule_snapshot_check",
      sql`jsonb_typeof(${t.taxRuleSnapshot}) = 'object'`,
    ),
    check(
      "calculation_snapshot_rounding_scales_check",
      sql`jsonb_typeof(${t.roundingScales}) = 'object'`,
    ),
    check("calculation_snapshot_totals_check", sql`jsonb_typeof(${t.totals}) = 'object'`),
  ],
);

export const snapshotComponent = pgTable(
  "snapshot_component",
  {
    id: uuidPk(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => calculationSnapshot.id, { onDelete: "cascade" }),
    componentKind: text("component_kind").notNull(),
    itemId: uuid("item_id").references(() => item.id),
    quantity: quantity("quantity"),
    unitId: uuid("unit_id").references(() => unit.id),
    unitCost: money("unit_cost"),
    amount: money("amount"),
    roundingBoundary: text("rounding_boundary"),
    provenance: jsonObject("provenance"),
  },
  (t) => [
    check(
      "snapshot_component_rounding_boundary_check",
      enumCheck(t.roundingBoundary, ROUNDING_BOUNDARY),
    ),
    index("snapshot_component_snapshot_idx").on(t.snapshotId),
  ],
);
