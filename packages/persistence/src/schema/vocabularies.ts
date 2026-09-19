// Controlled vocabularies for the Phase 1-2 core schema.
//
// Single source of truth in TypeScript: `schemas/domain-enums.yaml` is the
// authority for the domain vocabulary, and the SQL `check` constraints in the
// table modules are built from these arrays (see `enumCheck` in `./columns`),
// so a value cannot drift between the schema and the checks.

export const DOCUMENT_STATUS = ["draft", "submitted", "approved", "rejected", "retired"] as const;

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

// Values from `schemas/domain-enums.yaml` (`price_scenario_state`): a subset of
// `document_status`, minus `retired`.
export const PRICE_SCENARIO_STATE = ["draft", "submitted", "approved", "rejected"] as const;
