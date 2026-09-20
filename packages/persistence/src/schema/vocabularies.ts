// Controlled vocabularies for the Phase 1-2 core schema.
//
// Single source of truth in TypeScript: `schemas/domain-enums.yaml` is the
// authority for the domain vocabulary, and the SQL `check` constraints in the
// table modules are built from these arrays (see `enumCheck` in `./columns`),
// so a value cannot drift between the schema and the checks.

export const DOCUMENT_STATUS = ["draft", "submitted", "approved", "rejected", "retired"] as const;

// Values from `schemas/domain-enums.yaml` (`receipt_status`): per-entity
// workflow states take precedence over the generic `document_status`.
export const RECEIPT_STATUS = ["draft", "submitted", "accepted", "rejected", "reversed"] as const;

export const ITEM_TYPE = [
  "ingredient",
  "packaging",
  "cleaning_supply",
  "consumable",
  "intermediate",
  "finished_good",
  "non_stock_supply",
] as const;

export const INVENTORY_POLICY = ["stocked", "non_stock", "made_to_order"] as const;

export const LOCATION_KIND = ["operating", "central_production", "virtual_transit"] as const;

export const STORAGE_AREA_KIND = [
  "kitchen",
  "dry_store",
  "refrigerator",
  "freezer",
  "front_counter",
  "transit",
  "other",
] as const;

export const RECIPE_COMPONENT_KIND = ["ingredient", "packaging", "sub_recipe"] as const;

// `recipe_allergen.source`: a declaration that was derived from a source
// ingredient versus one a human explicitly verified.
export const ALLERGEN_SOURCE = ["derived", "verified"] as const;

export const PRODUCT_KIND = ["base", "variant", "add_on"] as const;

export const COST_CARD_STATE = ["draft", "approved", "superseded"] as const;

export const STOCK_MOVEMENT_TYPE = [
  "receipt",
  "receipt_reversal",
  "production_consumption",
  "production_output",
  "sale_consumption",
  "transfer_dispatch",
  "transfer_receipt",
  "waste",
  "count_adjustment",
  "correction",
  "revaluation",
] as const;

export const MOVEMENT_SOURCE_TYPE = [
  "goods_receipt",
  "production_batch",
  "transfer",
  "stock_count",
  "sales_line",
  "waste_event",
  "adjustment",
  "revaluation",
  "correction",
] as const;

export const TAX_BASIS = ["inclusive", "exclusive"] as const;

export const TAX_TREATMENT = ["fixed", "channel_overridable"] as const;

export const TAX_APPLIES_TO = ["product", "service", "fee", "cost"] as const;

// Values from `schemas/domain-enums.yaml` (`scope_type`). Used by `allocation_rule`,
// where the split is by driver: `organization`/`company_wide` are org-wide scopes and
// `location`/`storage`/`channel` are narrower ones. The `equal_share` fallback is only
// meaningful for an `organization`/`company_wide` rule, since a narrower scope would
// need its own eligible-entity set; enforcing that structurally is deferred, so the
// rule and the fallback are validated separately today.
export const SCOPE_TYPE = [
  "organization",
  "location",
  "storage",
  "channel",
  "company_wide",
] as const;

export const ROUNDING_METHOD = ["HALF_UP", "HALF_EVEN"] as const;

export const ROUNDING_BOUNDARY = ["B0", "B1", "B2", "B3", "B4"] as const;

export const COST_SELECTION_POLICY = [
  "latest_approved_price",
  "moving_weighted_average",
  "standard_cost",
] as const;

export const COST_SOURCE = ["receipt", "manual", "excel"] as const;

export const FEE_KIND = [
  "commission_pct",
  "processing_pct",
  "fixed_per_order",
  "delivery_subsidy",
  "discount_funding",
] as const;

export const FEE_BASIS = ["gross_price", "net_price", "per_order"] as const;

export const UNIT_DIMENSION = ["mass", "volume", "count", "time", "package"] as const;

// Values from `schemas/domain-enums.yaml` (`cost_center_kind`).
export const COST_CENTER_KIND = [
  "company_shared",
  "location",
  "kitchen",
  "front_of_house",
  "project",
] as const;

export const ROLE_CODE = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
  "purchasing",
  "finance",
  "admin",
  "analyst",
  "product_owner",
  "technical_owner",
  "data_owner",
] as const;

export const DATA_AREA = [
  "products_recipes_allergens",
  "supplier_items_costs",
  "prices_channels_tax",
  "inventory_waste",
  "sales_mappings_settlements",
  "labor_assumptions",
  "competitor_observations",
  "user_access_audit",
] as const;

// Values from `schemas/domain-enums.yaml` (`app_user_status`).
export const APP_USER_STATUS = ["invited", "active", "disabled", "locked"] as const;

/** Narrow type for `app_user.status`, so comparisons cannot drift into typos. */
export type UserStatus = (typeof APP_USER_STATUS)[number];

// Values from `schemas/domain-enums.yaml` (`price_scenario_state`): a subset of
// `document_status`, minus `retired`.
export const PRICE_SCENARIO_STATE = ["draft", "submitted", "approved", "rejected"] as const;

// Slice 6 (operating costs + labour + allocation), from
// `schemas/domain-enums.yaml`: how an operating cost behaves as volume changes,
// how often it recurs, what an `allocation_rule` is driven by, and what happens
// when the driver denominator is missing or zero.
export const COST_BEHAVIOR = ["fixed", "variable", "mixed"] as const;

export const OPERATING_COST_RECURRENCE = [
  "one_off",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "annual",
] as const;

export const ALLOCATION_DRIVER = [
  "direct_location_assignment",
  "occupied_area",
  "equipment_use",
  "production_hours",
  "production_minutes",
  "operating_hours",
  "transactions",
  "revenue",
  "recorded_time",
  "eligible_products",
  "equal_share",
] as const;

export const ALLOCATION_FALLBACK = ["stop", "equal_share"] as const;
