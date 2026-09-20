import { sql } from "drizzle-orm";
import { check, index, jsonb, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { item, unit } from "./catalog";
import {
  approvalCheck,
  currency,
  dateRange,
  enumCheck,
  jsonObject,
  money,
  orgId,
  quantity,
  rangeCheck,
  rate,
  tstz,
  uuidPk,
} from "./columns";
import { channel, costCenter, location, organization } from "./organization";
import { productVariant } from "./products";
import { recipeVersion } from "./recipes";
import { exchangeRate } from "./tax";
import {
  ALLOCATION_DRIVER,
  ALLOCATION_FALLBACK,
  COST_BEHAVIOR,
  COST_CARD_STATE,
  OPERATING_COST_RECURRENCE,
  PRICE_SCENARIO_STATE,
  ROLE_CODE,
  ROUNDING_BOUNDARY,
  ROUNDING_METHOD,
  SCOPE_TYPE,
  SNAPSHOT_COMPONENT_KIND,
  TAX_BASIS,
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
    // Deferred from the Phase 1-2 core (`DATA_DICTIONARY` §price_scenario) and
    // added with the slice-7 pricing work.
    targetContributionPct: rate("target_contribution_pct"),
    volumeAssumption: quantity("volume_assumption"),
    feeBreakdown: jsonObject("fee_breakdown"),
    outcome: jsonObject("outcome"),
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
    index("calculation_snapshot_cost_card_idx").on(t.costCardId, t.createdAt),
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
    check("snapshot_component_kind_check", enumCheck(t.componentKind, SNAPSHOT_COMPONENT_KIND)),
    check(
      "snapshot_component_rounding_boundary_check",
      enumCheck(t.roundingBoundary, ROUNDING_BOUNDARY),
    ),
    index("snapshot_component_snapshot_idx").on(t.snapshotId),
  ],
);

/**
 * `operating_cost` (`DATA_DICTIONARY` §4, COST-003): a dated overhead fact — rent,
 * utilities, subscriptions — with its recurrence, cost behaviour and tax basis.
 * Effective-dated with `date` columns; unlike `labor_rate`/`cost_pool`, two
 * concurrent costs in one cost centre are legitimate (rent and insurance share a
 * window), so there is deliberately **no** overlap exclusion here (see
 * `0012_cost_allocation_invariants.sql`).
 */
export const operatingCost = pgTable(
  "operating_cost",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    locationId: uuid("location_id").references(() => location.id),
    costCenterId: uuid("cost_center_id")
      .notNull()
      .references(() => costCenter.id),
    amount: money("amount").notNull(),
    currency: currency().notNull(),
    recurrence: text("recurrence").notNull(),
    behavior: text("behavior").notNull(),
    taxBasis: text("tax_basis").notNull(),
    ...dateRange(),
    vendor: text("vendor"),
    // FK deferred: points at a platform file object, added when that slice lands
    // (see the runbook's deferred-FK list and DATA_DICTIONARY §4).
    evidenceFileId: uuid("evidence_file_id"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("operating_cost_recurrence_check", enumCheck(t.recurrence, OPERATING_COST_RECURRENCE)),
    check("operating_cost_behavior_check", enumCheck(t.behavior, COST_BEHAVIOR)),
    check("operating_cost_tax_basis_check", enumCheck(t.taxBasis, TAX_BASIS)),
    check("operating_cost_amount_check", sql`${t.amount} >= 0`),
    check("operating_cost_effective_range_check", rangeCheck(t.effectiveFrom, t.effectiveTo)),
    index("operating_cost_lookup_idx").on(t.organizationId, t.costCenterId, t.effectiveFrom),
  ],
);

/**
 * `labor_rate` (`DATA_DICTIONARY` §4, COST-004): the loaded hourly rate for a
 * role in a cost centre, with a productive-hours percentage. Effective-dated
 * with `date` columns and versioned by role, so
 * `labor_rate_no_overlap` (hand-written in
 * `0012_cost_allocation_invariants.sql` — drizzle-kit cannot express an
 * exclusion constraint) rejects overlapping windows for one
 * `(organization_id, cost_center_id, role_code)`.
 */
export const laborRate = pgTable(
  "labor_rate",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    costCenterId: uuid("cost_center_id")
      .notNull()
      .references(() => costCenter.id),
    roleCode: text("role_code").notNull(),
    loadedHourlyRate: money("loaded_hourly_rate").notNull(),
    productiveHoursPct: numeric("productive_hours_pct", { precision: 6, scale: 4 }),
    ...dateRange(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("labor_rate_role_code_check", enumCheck(t.roleCode, ROLE_CODE)),
    check("labor_rate_loaded_hourly_rate_check", sql`${t.loadedHourlyRate} >= 0`),
    check(
      "labor_rate_productive_hours_pct_check",
      sql`${t.productiveHoursPct} is null or (${t.productiveHoursPct} > 0 and ${t.productiveHoursPct} <= 1)`,
    ),
    check("labor_rate_effective_range_check", rangeCheck(t.effectiveFrom, t.effectiveTo)),
    index("labor_rate_lookup_idx").on(
      t.organizationId,
      t.costCenterId,
      t.roleCode,
      t.effectiveFrom,
    ),
    // labor_rate_no_overlap (exclusion constraint) is emitted in the raw
    // `0012_cost_allocation_invariants` migration, as in `tax.ts`.
  ],
);

/**
 * `cost_pool` (`DATA_DICTIONARY` §4, COST-007): a named pool of shared costs that
 * allocation rules distribute across locations or products. Effective-dated with
 * `date` columns; `code` is versioned rather than unique, so
 * `cost_pool_no_overlap` (hand-written in
 * `0012_cost_allocation_invariants.sql`) rejects overlapping windows for one
 * `(organization_id, code)`.
 */
export const costPool = pgTable(
  "cost_pool",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    ...dateRange(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("cost_pool_effective_range_check", rangeCheck(t.effectiveFrom, t.effectiveTo)),
    index("cost_pool_organization_id_code_idx").on(t.organizationId, t.code),
    // cost_pool_no_overlap (exclusion constraint) is emitted in the raw
    // `0012_cost_allocation_invariants` migration, as in `tax.ts`.
  ],
);

/**
 * `allocation_rule` (`DATA_DICTIONARY` §4, COST-007/011): how one cost pool is
 * split — `driver` selects the basis, `scope_type` narrows the target,
 * `denominator_source` names where the driver quantity comes from, and
 * `fallback_behavior` decides what happens when that denominator is missing or
 * zero (`stop` or `equal_share`). Effective-dated with `date` columns and
 * scoped through `cost_pool` (no own `organization_id`), so
 * `allocation_rule_no_overlap` (hand-written in
 * `0012_cost_allocation_invariants.sql`) rejects overlapping windows per pool.
 */
export const allocationRule = pgTable(
  "allocation_rule",
  {
    id: uuidPk(),
    costPoolId: uuid("cost_pool_id")
      .notNull()
      .references(() => costPool.id),
    driver: text("driver").notNull(),
    scopeType: text("scope_type").notNull(),
    denominatorSource: text("denominator_source").notNull(),
    fallbackBehavior: text("fallback_behavior").notNull(),
    ...dateRange(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("allocation_rule_driver_check", enumCheck(t.driver, ALLOCATION_DRIVER)),
    check("allocation_rule_scope_type_check", enumCheck(t.scopeType, SCOPE_TYPE)),
    check(
      "allocation_rule_denominator_source_check",
      sql`length(btrim(${t.denominatorSource})) > 0`,
    ),
    check(
      "allocation_rule_fallback_behavior_check",
      enumCheck(t.fallbackBehavior, ALLOCATION_FALLBACK),
    ),
    check("allocation_rule_effective_range_check", rangeCheck(t.effectiveFrom, t.effectiveTo)),
    index("allocation_rule_cost_pool_idx").on(t.costPoolId),
    // allocation_rule_no_overlap (exclusion constraint) is emitted in the raw
    // `0012_cost_allocation_invariants` migration, as in `tax.ts`.
  ],
);
